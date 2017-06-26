"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const events_1 = require("events");
const google = require('googleapis');
const OAuth2 = google.auth.OAuth2;
class Credentials {
}
class Authentication extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        const auth = this.config.authentication;
        if (!auth || !auth.clientId || !auth.clientSecret || auth.clientId == 'YOUR_CLIENT_ID' || auth.clientSecret === 'YOUR_CLIENT_SECRET') {
            throw new Error('You have not set up your client id and client secret in the config.json file');
        }
        if (!auth.codeRedirectUri) {
            auth.codeRedirectUri = 'urn:ietf:wg:oauth:2.0:oob';
        }
        if (!auth.googleOAuthEndpoint) {
            auth.googleOAuthEndpoint = 'https://www.googleapis.com/oauth2/v4/';
        }
        if (!auth.scope && !auth.scopes) {
            auth.scopes = ['https://www.googleapis.com/auth/assistant-sdk-prototype'];
        }
        else if (!auth.scopes) {
            auth.scopes = [auth.scope];
        }
        if (!auth.urlGoogleAccount) {
            auth.urlGoogleAccount = 'https://accounts.google.com/o/oauth2/v2/auth';
        }
        if (!auth.credentialsFilePath) {
            auth.credentialsFilePath = './credentials.json';
        }
        if (!auth.maxDelayBeforeRefresh) {
            auth.maxDelayBeforeRefresh = 300000;
        }
        this.oauth2Client = new OAuth2(auth.clientId, auth.clientSecret, auth.codeRedirectUri);
    }
    saveCredentials(creds) {
        this.oauth2Client.setCredentials(creds);
        this.credentials = creds;
        const file = fs.createWriteStream(this.config.authentication.credentialsFilePath);
        file.write(JSON.stringify(creds));
        file.end();
    }
    loadCredentials(access_token) {
        this.oauth2Client.setCredentials({ access_token });
        this.emit('oauth-ready', this.oauth2Client);
    }
    getClient() {
        return this.oauth2Client;
    }
}
exports.Authentication = Authentication;