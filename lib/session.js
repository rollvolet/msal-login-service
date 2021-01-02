import { uuid, sparqlEscapeUri, sparqlEscapeString, sparqlEscapeDateTime } from 'mu';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';

const serviceHomepage = 'https://github.com/rollvolet/msal-login-service';
const resourceBaseUri = process.env.RESOURCE_BASE_URI || 'http://data.rollvolet.be/';
const personResourceBaseUri = `${resourceBaseUri}persons/`;
const accountResourceBaseUri = `${resourceBaseUri}accounts/`;

const sessionsGraph = 'http://mu.semte.ch/graphs/sessions';
const accountsGraph = 'http://mu.semte.ch/graphs/rollvolet';

async function removeSession(sessionUri) {
  await update(
    `PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
     PREFIX session: <http://mu.semte.ch/vocabularies/session/>
     PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
     PREFIX dcterms: <http://purl.org/dc/terms/>

     DELETE WHERE {
       GRAPH <http://mu.semte.ch/graphs/sessions> {
           ${sparqlEscapeUri(sessionUri)} session:account ?account ;
                                          mu:uuid ?id .
       }
     }`);
}

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
    FROM <${accountsGraph}> {
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
      GRAPH <${accountsGraph}> {
        ${sparqlEscapeUri(person)} a foaf:Person ;
                                 mu:uuid ${sparqlEscapeString(personUuid)} ;
                                 dct:identifier ${sparqlEscapeString(personId)} .
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
  const accountId = authenticationResult.account.localAccountId;

  const queryResult = await query(`
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?account ?accountId
    FROM <${accountsGraph}> {
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
  const accountId = authenticationResult.account.localAccountId;
  const accountUuid = uuid();
  const account = `${accountResourceBaseUri}${accountUuid}`;
  const now = new Date();

  let insertData = `
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>

    INSERT DATA {
      GRAPH <${accountsGraph}> {
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

async function insertNewSessionForAccount(accountUri, sessionUri) {
  const sessionId = uuid();
  const now = new Date();

  let insertData = `
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX session: <http://mu.semte.ch/vocabularies/session/>
    PREFIX dct: <http://purl.org/dc/terms/>

    INSERT DATA {
      GRAPH <${sessionsGraph}> {
        ${sparqlEscapeUri(sessionUri)} mu:uuid ${sparqlEscapeString(sessionId)} ;
                                 session:account ${sparqlEscapeUri(accountUri)} ;
                                 dct:modified ${sparqlEscapeDateTime(now)} .
      }
    }`;

  await update(insertData);
  return { sessionUri, sessionId };
};

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
      GRAPH <${accountsGraph}> {
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
      GRAPH <${accountsGraph}> {
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

export {
  removeSession,
  ensureUserAndAccount,
  insertNewSessionForAccount,
  selectAccountBySession,
  selectCurrentSession
}
