import { uuid, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime } from 'mu';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';

const serviceHomepage = 'https://github.com/rollvolet/msal-login-service';
const resourceBaseUri = process.env.RESOURCE_BASE_URI || 'http://data.rollvolet.be/';
const personResourceBaseUri = `${resourceBaseUri}persons/`;
const accountResourceBaseUri = `${resourceBaseUri}accounts/`;
const sessionResourceBaseUri = `${resourceBaseUri}sessions/`;

const sessionsGraph = process.env.SESSIONS_GRAPH || 'http://mu.semte.ch/graphs/sessions';
const usersGraph = process.env.USERS_GRAPH || 'http://mu.semte.ch/graphs/users';
const defaultUserGroup = process.env.DEFAULT_USER_GROUP || 'http://data.rollvolet.be/user-groups/employee';

async function ensureUserAndAccount(authenticationResult) {
  const { personUri } = await ensureUser(authenticationResult);
  const { accountUri, accountId } = await ensureAccountForUser(personUri, authenticationResult);
  return { accountUri, accountId };
}

async function ensureUser(authenticationResult) {
  const userId = authenticationResult.uniqueId;

  const queryResult = await query(`
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?person ?personId
    FROM <${usersGraph}> {
      ?person a foaf:Person ;
            mu:uuid ?personId ;
            dct:identifier ${sparqlEscapeString(userId)} .
    }`);

  if (queryResult.results.bindings.length) {
    const result = queryResult.results.bindings[0];
    return { personUri: result.person.value, personId: result.personId.value };
  } else {
    const { personUri, personId } = await insertNewUser(authenticationResult);
    return { personUri, personId };
  }
};

async function insertNewUser(authenticationResult) {
  const personId = authenticationResult.uniqueId;
  const personUuid = uuid();
  const person = `${personResourceBaseUri}${personUuid}`;
  const now = new Date();

  let insertData = `
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>

    INSERT DATA {
      GRAPH <${usersGraph}> {
        ${sparqlEscapeUri(person)} a foaf:Person ;
                                 mu:uuid ${sparqlEscapeString(personUuid)} ;
                                 dct:identifier ${sparqlEscapeString(personId)} ;
                                 foaf:member <${defaultUserGroup}> .
    `;

  if (authenticationResult.account && authenticationResult.account.name)
    insertData += `${sparqlEscapeUri(person)} foaf:name ${sparqlEscapeString(authenticationResult.account.name)} . \n`;

  insertData += `
      }
    }
  `;

  await update(insertData);

  return { personUri: person, personId: personId };
};

async function ensureAccountForUser(personUri, authenticationResult) {
  const accountId = authenticationResult.account.homeAccountId;

  const queryResult = await query(`
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?account ?accountId
    FROM <${usersGraph}> {
      ${sparqlEscapeUri(personUri)} foaf:account ?account .
      ?account a foaf:OnlineAccount ;
               mu:uuid ?accountId ;
               dct:identifier ${sparqlEscapeString(accountId)} .
    }`);

  if (queryResult.results.bindings.length) {
    const result = queryResult.results.bindings[0];
    return { accountUri: result.account.value, accountId: result.accountId.value };
  } else {
    const { accountUri, accountId } = await insertNewAccountForUser(personUri, authenticationResult);
    return { accountUri, accountId };
  }
};


async function insertNewAccountForUser(person, authenticationResult) {
  const accountId = authenticationResult.account.homeAccountId;
  const accountUuid = uuid();
  const account = `${accountResourceBaseUri}${accountUuid}`;
  const now = new Date();

  let insertData = `
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>

    INSERT DATA {
      GRAPH <${usersGraph}> {
        ${sparqlEscapeUri(person)} foaf:account ${sparqlEscapeUri(account)} .
        ${sparqlEscapeUri(account)} a foaf:OnlineAccount ;
                                 mu:uuid ${sparqlEscapeString(accountId)} ;
                                 foaf:accountServiceHomepage ${sparqlEscapeUri(serviceHomepage)} ;
                                 dct:identifier ${sparqlEscapeString(accountId)} ;
                                 dct:created ${sparqlEscapeDateTime(now)} .
    `;

  if (authenticationResult.account.username)
    insertData += `${sparqlEscapeUri(account)} foaf:accountName ${sparqlEscapeString(authenticationResult.account.username)} . \n`;

  insertData += `
      }
    }
  `;

  await update(insertData);

  return { accountUri: account, accountId: accountId };
};

async function getUserGroups(account) {
  const queryResult = await query(`
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    SELECT ?group
    WHERE {
      GRAPH <${usersGraph}> {
        ?person foaf:account ${sparqlEscapeUri(account)} ; foaf:member ?group .
      }
    }
  `);

  return queryResult.results.bindings.map(b => b['group'].value);
}

async function insertNewSessionForAccount(accountUri, sessionUri, tokenInfo) {
  const sessionId = uuid();
  const now = new Date();

  await update(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX session: <http://mu.semte.ch/vocabularies/session/>
    PREFIX dct: <http://purl.org/dc/terms/>

    INSERT DATA {
      GRAPH <${sessionsGraph}> {
        ${sparqlEscapeUri(sessionUri)} mu:uuid ${sparqlEscapeString(sessionId)} ;
                                 session:account ${sparqlEscapeUri(accountUri)} ;
                                 dct:modified ${sparqlEscapeDateTime(now)} .
      }
    }`);

  if (tokenInfo)
    insertTokenInfoForSession(sessionUri, tokenInfo);

  return { sessionUri, sessionId };
}

async function insertTokenInfoForSession(session, tokenInfo) {
  const oauthSessionUuid = uuid();
  const oauthSession = `${sessionResourceBaseUri}${oauthSessionUuid}`;
  await update(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX oauth: <http://data.rollvolet.be/vocabularies/oauth-2.0/>
    INSERT DATA {
      GRAPH <${sessionsGraph}> {
        ${sparqlEscapeUri(oauthSession)} mu:uuid ${sparqlEscapeString(oauthSessionUuid)} ;
                               oauth:authenticates ${sparqlEscapeUri(session)} ;
                               oauth:tokenValue ${sparqlEscapeString(tokenInfo.accessToken)} ;
                               oauth:expirationDate ${sparqlEscapeDateTime(tokenInfo.expirationDate)} .
      }
    }`);
}

async function updateTokenInfoForSession(session, tokenInfo) {
  const queryResult = await query(`
    PREFIX oauth: <http://data.rollvolet.be/vocabularies/oauth-2.0/>
    SELECT ?oauthSession WHERE {
      GRAPH <${sessionsGraph}> {
        ?oauthSession oauth:authenticates ${sparqlEscapeUri(session)} .
      }
    } LIMIT 1`);

  if (queryResult.results.bindings.length) {
    const oauthSession = queryResult.results.bindings[0]['oauthSession'].value;
    await update(`
      PREFIX oauth: <http://data.rollvolet.be/vocabularies/oauth-2.0/>
      DELETE WHERE {
        GRAPH <${sessionsGraph}> {
          ${sparqlEscapeUri(oauthSession)} oauth:tokenValue ?tokenValue ;
                                 oauth:expirationDate ?expirationDate .
        }
      }`);
    await update(`
      PREFIX oauth: <http://data.rollvolet.be/vocabularies/oauth-2.0/>
      INSERT DATA {
        GRAPH <${sessionsGraph}> {
          ${sparqlEscapeUri(oauthSession)} oauth:tokenValue ${sparqlEscapeString(tokenInfo.accessToken)} ;
                                           oauth:expirationDate ${sparqlEscapeDateTime(tokenInfo.expirationDate)} .
        }
      }`);
  } else {
    await insertTokenInfoForSession(session, tokenInfo);
  }
}

async function selectAccountBySession(session) {
  const queryResult = await query(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX session: <http://mu.semte.ch/vocabularies/session/>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>

    SELECT ?account ?accountId
    WHERE {
      GRAPH <${sessionsGraph}> {
          ${sparqlEscapeUri(session)} session:account ?account .
      }
      GRAPH <${usersGraph}> {
          ?account a foaf:OnlineAccount ;
                   mu:uuid ?accountId .
      }
    }`);

  if (queryResult.results.bindings.length) {
    const result = queryResult.results.bindings[0];
    return { accountUri: result.account.value, accountId: result.accountId.value };
  } else {
    return { accountUri: null, accountId: null };
  }
};

async function selectCurrentSession(session) {
  const queryResult = await query(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX session: <http://mu.semte.ch/vocabularies/session/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>

    SELECT ?sessionId ?name ?username
    WHERE {
      GRAPH <${sessionsGraph}> {
          ${sparqlEscapeUri(session)} session:account ?account ;
                   mu:uuid ?sessionId .
      }
      GRAPH <${usersGraph}> {
          ?account a foaf:OnlineAccount .
          ?person foaf:account ?account .
          OPTIONAL { ?account foaf:accountName ?username . }
          OPTIONAL { ?person foaf:name ?name . }
      }
    }`);

  if (queryResult.results.bindings.length) {
    const result = queryResult.results.bindings[0];
    return {
      sessionUri: session,
      sessionId: result.sessionId.value,
      username: result.username && result.username.value,
      name: result.name && result.name.value
    };
  } else {
    return { sessionUri: null, sessionId: null, username: null, name: null };
  }
};


async function removeSession(sessionUri) {
  // Remove related oauth session if it exists
  await update(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX oauth: <http://data.rollvolet.be/vocabularies/oauth-2.0/>
    DELETE WHERE {
      GRAPH <${sessionsGraph}> {
        ?oauthSession mu:uuid ?uuid ;
                      oauth:authenticates ${sparqlEscapeUri(sessionUri)} ;
                      oauth:tokenValue ?tokenValue ;
                      oauth:expirationDate ?expirationDate .
      }
    }`);

  await update(
    `PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
     PREFIX session: <http://mu.semte.ch/vocabularies/session/>

     DELETE WHERE {
       GRAPH <${sessionsGraph}> {
           ${sparqlEscapeUri(sessionUri)} session:account ?account ;
                                          mu:uuid ?id .
       }
     }`);
}

async function getAllOAuthSessions() {
  const queryResult = await query(
    `PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
     PREFIX session: <http://mu.semte.ch/vocabularies/session/>
     PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
     PREFIX dct: <http://purl.org/dc/terms/>
     PREFIX oauth: <http://data.rollvolet.be/vocabularies/oauth-2.0/>

     SELECT DISTINCT ?muSession ?oauthSession ?tokenValue ?expirationDate ?accountId {
       GRAPH <${sessionsGraph}> {
           ?muSession session:account ?account .
           ?oauthSession oauth:authenticates ?muSession ;
                         oauth:tokenValue ?tokenValue ;
                         oauth:expirationDate ?expirationDate .
       }
       GRAPH <${usersGraph}> {
           ?account dct:identifier ?accountId .
       }
     }`);

  return queryResult.results.bindings.map(b => {
    return {
      session: b['muSession'].value,
      oauthSession: b['oauthSession'].value,
      accessToken: b['tokenValue'].value,
      expirationDate: b['expirationDate'].value,
      accountId: b['accountId'].value
    };
  });
}

export {
  ensureUserAndAccount,
  insertNewSessionForAccount,
  getUserGroups,
  selectAccountBySession,
  selectCurrentSession,
  updateTokenInfoForSession,
  removeSession,
  getAllOAuthSessions
}
