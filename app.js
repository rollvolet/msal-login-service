import { app, errorHandler } from 'mu';
import { getSessionIdHeader, error } from './utils';
import TokenManager, { getTokenInfo } from './lib/token-manager';
import TokenManagerWithRefresh from './lib/token-manager-with-refresh';
import { removeSession, getUserGroups,
         ensureUserAndAccount, insertNewSessionForAccount,
         selectAccountBySession, selectCurrentSession } from './lib/session';

/**
 * Configuration validation on startup
 */
[ 'AUTH_CLIENT_ID',
  'AUTH_CLIENT_SECRET',
  'AUTH_REDIRECT_URI' ].forEach(key => {
    if (!process.env[key]) {
      console.log(`Environment variable ${key} must be configured`);
      process.exit(1);
    }
  });

const tokenManager = process.env.AUTH_REFRESH_TOKENS ? new TokenManagerWithRefresh() : new TokenManager();

/**
 * Log the user in by creating a new session, i.e. attaching the user's account to a session.
 *
 * Before creating a new session, the given authorization code gets exchanged for an access token
 * with Microsoft Identify Platform using MSAL. The returned JWT access token
 * is decoded to retrieve information to attach to the user, account and the session.
 * If the OpenID Provider returns a valid access token, a new user and account are created if they
 * don't exist yet and a the account is attached to the session.
 *
 * Body: { authorizationCode: "secret" }
 *
 * @return [201] On successful login containing the newly created session
 * @return [400] If the session header or authorization code is missing
 * @return [401] On login failure (unable to retrieve a valid access token)
 * @return [403] If no bestuurseenheid can be linked to the session
*/
app.post('/sessions', async function(req, res, next) {
  const sessionUri = getSessionIdHeader(req);
  if (!sessionUri)
    return error(res, 'Session header is missing');

  const authorizationCode = req.body['authorizationCode'];
  if (!authorizationCode)
    return error(res, 'Authorization code is missing');

  try {
    let authenticationResult;
    try {
      authenticationResult = await tokenManager.getAccessToken(authorizationCode);
    } catch(e) {
      console.log(`Failed to retrieve access token for authorization code: ${e.message || e}`);
      return res.header('mu-auth-allowed-groups', 'CLEAR').status(401).end();
    }

    if (process.env['DEBUG_MSAL_AUTH']) {
      console.log(`Received authenticationResult ${JSON.stringify(authenticationResult)}`);
    }

    const { accountUri, accountId } = await ensureUserAndAccount(authenticationResult);

    const tokenInfo = {
      homeAccountId: authenticationResult.account.homeAccountId,
      accessToken: authenticationResult.accessToken,
      expirationDate: new Date(Date.parse(authenticationResult.expiresOn))
    };

    const userGroups = await getUserGroups(accountUri);
    const { sessionId } = await insertNewSessionForAccount(accountUri, sessionUri, tokenInfo);
    tokenManager.scheduleTokenRefresh(sessionUri, tokenInfo);

    return res.header('mu-auth-allowed-groups', 'CLEAR').status(201).send({
      links: {
        self: '/sessions/current'
      },
      data: {
        type: 'sessions',
        id: sessionId,
        attributes: {
          name: authenticationResult.account.name,
          username: authenticationResult.account.username,
          'user-groups': userGroups
        }
      },
      relationships: {
        account: {
          links: { related: `/accounts/${accountId}` },
          data: { type: 'accounts', id: accountId }
        }
      }
    });
  } catch(e) {
    return next(new Error(e.message));
  }
});


/**
 * Log out from the current session, i.e. detaching the session from the user's account.
 *
 * @return [204] On successful logout
 * @return [400] If the session header is missing or invalid
*/
app.delete('/sessions/current', async function(req, res, next) {
  const sessionUri = getSessionIdHeader(req);
  if (!sessionUri)
    return error(res, 'Session header is missing');

  try {
    const { accountUri } = await selectAccountBySession(sessionUri);
    if (!accountUri)
      return error(res, 'Invalid session');

    await removeSession(sessionUri);
    await tokenManager.cancelTokenRefresh(sessionUri);

    return res.header('mu-auth-allowed-groups', 'CLEAR').status(204).end();
  } catch(e) {
    return next(new Error(e.message));
  }
});

/**
 * Get the current session
 *
 * @return [200] The current session
 * @return [400] If the session header is missing or invalid
*/
app.get('/sessions/current', async function(req, res, next) {
  const sessionUri = getSessionIdHeader(req);
  if (!sessionUri)
    return next(new Error('Session header is missing'));

  try {
    const { accountUri, accountId } = await selectAccountBySession(sessionUri);
    if (!accountUri) {
      res.header('mu-auth-allowed-groups', 'CLEAR');
      return error(res, 'Invalid session. No related account found.');
    }

    const { sessionId, name, username } = await selectCurrentSession(sessionUri);
    const userGroups = await getUserGroups(accountUri);

    if (!tokenManager.hasValidToken(sessionUri)) {
      await removeSession(sessionUri);
      res.header('mu-auth-allowed-groups', 'CLEAR');
      return error(res, 'Invalid session. No access token available.');
    } else {
      return res.status(200).send({
        links: {
          self: '/sessions/current'
        },
        data: {
          type: 'sessions',
          id: sessionId,
          attributes: {
            name,
            username,
            'user-groups': userGroups
          }
        },
        relationships: {
          account: {
            links: { related: `/accounts/${accountId}` },
            data: { type: 'accounts', id: accountId }
          }
        }
      });
    }
  } catch(e) {
    res.header('mu-auth-allowed-groups', 'CLEAR');
    return next(new Error(e.message));
  }
});


app.use(errorHandler);
