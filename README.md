# MSAL login service

Microservice to authenticate using Microsoft Authentication Library (MSAL)

## Getting started
### Adding the service to your stack
Add the following snippet to your `docker-compose.yml` to include the login service in your project.

```yaml
login:
  image: rollvolet/msal-login-service
```

Add rules to the `dispatcher.ex` to dispatch requests to the login service. E.g.

```elixir
  match "/sessions/*path", %{ accept: %{ json: true } } do
    Proxy.forward conn, path, "http://login/sessions/"
  end
```

## How-to guides
### How to keep the OAuth access tokens fresh
On login the access token retrieved from the Microsoft Identity Platform is stored in the triplestore. That way other microservices can use the token to make requests to 3rd party APIs on behalf of the user.

However, the access tokens only have a limited lifetime (default 1h). To enable automatic refresh of the access tokens in the backend before they expire, add the following snippet to your `docker-compose.yml`

```yaml
login:
  image: rollvolet/msal-login-service
  environment:
    AUTH_REFRESH_TOKENS: "true"
token-cache:
  image: redis:6.2.6
  volumes:
    - ./data/token-cache:/data
```

The token cache will be persisted in `./data/token-cache`. The persistence is required to restore token refreshes on (re)start of the login service. If a token refresh cannot be restored, the session will be logged out in the triplestore.

## Reference
### Configuration
The following enviroment variables must be configured:
- **AUTH_CLIENT_ID**: Client id of the application in Azure
- **AUTH_CLIENT_SECRET**: Client secret of the application in Azure
- **AUTH_REDIRECT_URI**: Redirect URI of the application configured in Azure

The following enviroment variables can optionally be configured:
- **AUTH_TENANT_ID**: Tenant id of the organization in Azure
- **AUTH_SCOPES**: Whitespace-separated string of scopes to grant access for (default `User.Read`)
- **AUTH_REFRESH_TOKENS**: Enable automatic token refreshes before expiry time (disabled by default)
- **REDIS_ENDPOINT**: URL of the Redis endpoint, used as token cache (default `redis://token-cache:6379`). Only applicable if token refresh is enabled.
- **DEBUG_MSAL_AUTH**: When set, verbose logging of the interaction with Microsoft Identity Platform
- **USERS_GRAPH** : graph in which the person and account resources will be stored. Defaults to `http://mu.semte.ch/graphs/users`.
- **SESSIONS_GRAPH** : graph in which the session resources will be stored. Defaults to `http://mu.semte.ch/graphs/sessions`.
- **DEFAULT_USER_GROUP** : default user group to assign to new users. Defaults to `http://data.rollvolet.be/user-groups/employee`.
- **RESOURCE_BASE_URI**: Base URI to use for resources created by this service. The URI must end with a trailing slash! (default: `http://data.rollvolet.be/`)

### API
#### POST /sessions
Log the user in by creating a new session, i.e. attaching the user's account to a session.

Before creating a new session, the given authorization code gets exchanged for an access token with Microsoft Identity Platform using MSAL and the configured client id and secret. If the authentication provider returns a valid access token, a new user and account are created if they don't exist yet and a the account is attached to the session.

The service uses the following claims:
* `authenticationResult.uniqueId`: identifier of the person
* `authenticationResult.account.name`: name of the person
* `authenticationResult.homeAccountId`: identifier of the account
* `authenticationResult.account.username`: username of the account

##### Request body
```javascript
{ authorizationCode: "secret" }
```

##### Response
###### 201 Created
On successful login with the newly created session in the response body:

```javascript
{
  "links": {
    "self": "sessions/current"
  },
  "data": {
    "type": "sessions",
    "id": "b178ba66-206e-4551-b41e-4a46983912c0",
    "attributes": {
      "name": "John Doe",
      "username": "john.doe@rollvolet.be"
    }
  },
  "relationships": {
    "account": {
      "links": {
        "related": "/accounts/f6419af0-c90f-465f-9333-e993c43e6cf2"
      },
      "data": {
        "type": "accounts",
        "id": "f6419af0-c90f-465f-9333-e993c43e6cf2"
      }
    }
  }
}
```

###### 400 Bad Request
- if session header is missing. The header should be automatically set by the [identifier](https://github.com/mu-semtech/mu-identifier).
- if the authorization code is missing

###### 401 Bad Request
- on login failure. I.e. failure to exchange the authorization code for a valid access token with Microsoft Identity Provider

#### DELETE /sessions/current
Log out the current user, i.e. remove the session associated with the current user's account.

##### Response
###### 204 No Content
On successful logout

###### 400 Bad Request
If session header is missing or invalid. The header should be automatically set by the [identifier](https://github.com/mu-semtech/mu-identifier).

#### GET /sessions/current
Get the current session

##### Response
###### 200 Created

```javascript
{
  "links": {
    "self": "sessions/current"
  },
  "data": {
    "type": "sessions",
    "id": "b178ba66-206e-4551-b41e-4a46983912c0",
    "attributes": {
      "name": "John Doe",
      "username": "john.doe@rollvolet.be"
    }
  },
  "relationships": {
    "account": {
      "links": {
        "related": "/accounts/f6419af0-c90f-465f-9333-e993c43e6cf2"
      },
      "data": {
        "type": "accounts",
        "id": "f6419af0-c90f-465f-9333-e993c43e6cf2"
      }
    }
  }
}
```

###### 400 Bad Request
If session header is missing or invalid. The header should be automatically set by the [identifier](https://github.com/mu-semtech/mu-identifier).


### Data model
#### Used prefixes
| Prefix  | URI                                              |
|---------|--------------------------------------------------|
| dct     | http://purl.org/dc/terms/                        |
| foaf    | http://xmlns.com/foaf/0.1/                       |
| session | http://mu.semte.ch/vocabularies/session/         |
| oauth   | http://data.rollvolet.be/vocabularies/oauth-2.0/ |

#### User
##### Class
`foaf:Person`
##### Properties
| Name        | Predicate        | Range                | Definition                 |
|-------------|------------------|----------------------|----------------------------|
| identifier  | `dct:identifier` | `xsd:string`         | Identifier of the person   |
| name        | `foaf:name`      | `xsd:string`         | Name of the person         |
| user-groups | `foaf:member`    | `foaf:Group`         | Groups the user belongs to |
| account     | `foaf:account`   | `foaf:OnlineAccount` | User's account             |

#### Account
##### Class
`foaf:OnlineAccount`
##### Properties
| Name       | Predicate                     | Range                | Definition                                        |
|------------|-------------------------------|----------------------|---------------------------------------------------|
| identifier | `dct:identifier`              | `xsd:string`         | Identifier of the account                         |
| name       | `foaf:accountName`            | `xsd:string`         | Name of the account                               |
| created    | `dct:created`                 | `xsd:dateTime`       | Creation date of the account                      |
| homepage   | `foaf:accountServiceHomepage` | `rdfs:Resource`      | `https://github.com/rollvolet/msal-login-service` |

#### Mu session
##### Properties
| Name     | Predicate         | Range                | Definition                |
|----------|-------------------|----------------------|---------------------------|
| account  | `session:account` | `foaf:OnlineAccount` | Account of to the session |
| modified | `dct:modified`    | `xsd:dateTime`       | Last modification time    |

#### Oauth session
##### Properties
| Name            | Predicate              | Range          | Definition                                 |
|-----------------|------------------------|----------------|--------------------------------------------|
| session         | `oauth:authenticates`  | `mu-session`   | Mu-session the oauth-session authenticates |
| token           | `oauth:tokenValue`     | `xsd:string`   | Oauth access token                         |
| expiration-date | `oauth:expirationDate` | `xsd:dateTime` | Expiration date of the access token        |

