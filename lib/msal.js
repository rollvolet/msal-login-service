import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node';

const tenantId = process.env.AUTH_TENANT_ID || '3e9b8827-39f2-4fb4-9bc1-f8a200aaea79';
const clientId =  process.env.AUTH_CLIENT_ID;
const clientSecret = process.env.AUTH_CLIENT_SECRET;
const redirectUri = process.env.AUTH_REDIRECT_URI;
const scopes = (process.env.AUTH_SCOPES && process.env.AUTH_SCOPES.split(',')) || ['User.Read'];

const config = {
  auth: {
    clientId,
    clientSecret,
    authority: `https://login.microsoftonline.com/${tenantId}`
  },
  system: {
    loggerOptions: {
      loggerCallback(loglevel, message, containsPii) {
        console.log(message);
      },
      piiLoggingEnabled: !!process.env['DEBUG_MSAL_AUTH'],
      logLevel: process.env['DEBUG_MSAL_AUTH'] ? LogLevel.Verbose : LogLevel.Info
    }
  }
};

const confidentialClientApp = new ConfidentialClientApplication(config);

/**
 * Exchange an authorization code for an access token with Microsoft Identity Platform using MSAL
 *
 * @param {string} authorizationCode The authorization code to exchange for an access token
 *
 * @return {TokenSet} The AutenticationResult received from Microsoft Identity Platform
 *                    See also https://azuread.github.io/microsoft-authentication-library-for-js/ref/msal-common/classes/_src_response_authenticationresult_.authenticationresult.html
 * @throw {Error} On failure to retrieve a valid access token from Microsoft Identity Platform
*/
async function getAccessToken(authorizationCode) {
  const tokenRequest = {
    code: authorizationCode,
    scopes: scopes,
    redirectUri: redirectUri
  };

  try {
    const authenticationResult = await confidentialClientApp.acquireTokenByCode(tokenRequest);
    return authenticationResult;
  } catch (error) {
    console.error(`Error while retrieving access token from Microsoft Identity Platform: ${error}`);
    console.trace(error);
    throw new Error(`Something went wrong while retrieving the access token: ${error}`);
  }
}

export {
  getAccessToken
}
