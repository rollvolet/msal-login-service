import { ConfidentialClientApplication, LogLevel } from '@azure/msal-node';

export default class TokenManager {
  constructor() {
    this.tenantId = process.env.AUTH_TENANT_ID || '3e9b8827-39f2-4fb4-9bc1-f8a200aaea79';
    this.redirectUri = process.env.AUTH_REDIRECT_URI;
    this.scopes = (process.env.AUTH_SCOPES && process.env.AUTH_SCOPES.split(' ')) || ['User.Read'];
    this.setupConfidentialClientApp();
  }

  get authority() {
    return `https://login.microsoftonline.com/${this.tenantId}`;
  }

  /**
   * Exchange an authorization code for an access token with Microsoft Identity Platform using MSAL
   *
   * @param {string} authorizationCode The authorization code to exchange for an access token
   *
   * @return {AuthenticationResult} The AutenticationResult received from Microsoft Identity Platform
   *                    See also https://azuread.github.io/microsoft-authentication-library-for-js/ref/msal-common/classes/_src_response_authenticationresult_.authenticationresult.html
   * @throw {Error} On failure to retrieve a valid access token from Microsoft Identity Platform
   *
   * @public
   */
  async getAccessToken(authorizationCode) {
    const tokenRequest = {
      code: authorizationCode,
      scopes: this.scopes,
      redirectUri: this.redirectUri
    };

    try {
      const authenticationResult = await this.clientApp.acquireTokenByCode(tokenRequest);
      return authenticationResult;
    } catch (error) {
      console.error(`Error while retrieving access token from Microsoft Identity Platform: ${error}`);
      console.trace(error);
      throw new Error(`Something went wrong while retrieving the access token: ${error}`);
    }
  }

  /**
   * @public
  */
  scheduleTokenRefresh(session, tokenInfo) { }
  cancelTokenRefresh(session) { }
  hasValidToken(session) { return true; }

  /**
   * @private
   */
  setupConfidentialClientApp() {
    const clientId =  process.env.AUTH_CLIENT_ID;
    const clientSecret = process.env.AUTH_CLIENT_SECRET;

    const config = {
      auth: {
        clientId,
        clientSecret,
        authority: this.authority
      },
      system: {
        loggerOptions: {
          loggerCallback(loglevel, message, containsPii) {
            console.log(message);
          },
          piiLoggingEnabled: !!process.env['DEBUG_MSAL_AUTH'],
          logLevel: process.env['DEBUG_MSAL_AUTH'] ? LogLevel.Debug : LogLevel.Warning
        }
      }
    };

    this.configureCache(config);

    this.clientApp = new ConfidentialClientApplication(config);
  }

  /**
   * @private
   */
  configureCache(config) { }
}

function getTokenInfo(authenticationResult) {
  return {
    homeAccountId: authenticationResult.account.homeAccountId,
    accessToken: authenticationResult.accessToken,
    expirationDate: new Date(Date.parse(authenticationResult.expiresOn))
  };
}

export { getTokenInfo }
