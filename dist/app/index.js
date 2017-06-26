"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_config_1 = require("./client-config");
const assistant_1 = require("./assistant");
const authentication_1 = require("./authentication");
const fs = require("fs");
const aws_sdk_1 = require("aws-sdk");
const alexa_sdk_1 = require("alexa-sdk");
const debug_1 = require("debug");
const TESTING = process.env.TESTING || false, NOT_FOUND = 'Sorry I don\'t know this command', UNHANDLED_RESP = 'Are you talking to me?', ERROR_RESP = 'Oops something went wrong', LINK_ACCOUNT = 'You must link your Google account to use this skill. Please use the link in the Alexa app to authorise your Google Account.', AWS_POLLY_AK = process.env.AWS_POLLY_AK, AWS_POLLY_SECRET = process.env.AWS_POLLY_SECRET, AWS_S3_KEY = process.env.AWS_S3_KEY, AWS_S3_SECRET = process.env.AWS_S3_SECRET, ASSISTANT_CLIENT_ID = process.env.ASSISTANT_CLIENT_ID, ASSISTANT_CLIENT_SECRET = process.env.ASSISTANT_CLIENT_SECRET, REDIRECT_URL = process.env.REDIRECT_URL, APP_ID = process.env.APP_ID;
const polly = new aws_sdk_1.Polly({
    accessKeyId: AWS_POLLY_AK,
    secretAccessKey: AWS_POLLY_SECRET,
    region: 'eu-west-1'
});
const s3 = new aws_sdk_1.S3({
    accessKeyId: AWS_S3_KEY,
    secretAccessKey: AWS_S3_SECRET
});
const allConfig = new client_config_1.Config();
allConfig.debug = debug_1.default('node-assistant');
allConfig.error = debug_1.default('node-assistant:error');
allConfig.authentication = new client_config_1.AuthenticationConfig();
allConfig.authentication.clientId = ASSISTANT_CLIENT_ID;
allConfig.authentication.clientSecret = ASSISTANT_CLIENT_SECRET;
allConfig.authentication.codeRedirectUri = REDIRECT_URL;
if (process.env.DEBUG === 'node-assistant') {
    allConfig.verbose = true;
}
const auth = new authentication_1.Authentication(allConfig);
const sendAudio = (text, assistant) => {
    let params = {
        OutputFormat: "pcm",
        SampleRate: "16000",
        Text: text,
        TextType: "text",
        VoiceId: "Joanna"
    };
    polly.synthesizeSpeech(params)
        .on('httpHeaders', function (statusCode, headers) {
        if (statusCode < 300) {
            const stream = this.response.httpResponse.createUnbufferedStream();
            assistant.requestAssistant(stream);
        }
    })
        .on('error', (response) => allConfig.error('Error while querying Polly', response))
        .send();
};
const assertConstants = (context) => {
    if (!AWS_POLLY_AK)
        context.emit(':tell', 'Amazon Polly Access Key environmental variable is not set');
    if (!AWS_POLLY_SECRET)
        context.emit(':tell', 'Amazon Polly Secret environmental variable is not set');
    if (!AWS_S3_KEY)
        context.emit(':tell', 'Amazon S3 Access Key environmental variable is not set');
    if (!AWS_S3_SECRET)
        context.emit(':tell', 'Amazon S3 Secret environmental variable is not set');
    if (!ASSISTANT_CLIENT_ID)
        context.emit(':tell', 'Google Assistant Client ID environmental variable is not set');
    if (!ASSISTANT_CLIENT_SECRET)
        context.emit(':tell', 'Google Assistant Client Secret environmental variable is not set');
    if (!REDIRECT_URL)
        context.emit(':tell', 'Redirect URL environmental variable is not set');
    return (!AWS_POLLY_AK
        || !AWS_POLLY_SECRET
        || !AWS_S3_KEY
        || !AWS_S3_SECRET
        || !ASSISTANT_CLIENT_ID
        || !ASSISTANT_CLIENT_SECRET
        || !REDIRECT_URL);
};
const callAssistant = function (query, context, ACCESS_TOKEN) {
    auth.on('oauth-ready', (oauth2Client) => {
        const assistant = new assistant_1.AssistantClient(allConfig, oauth2Client);
        allConfig.debug('Call assistant', query);
        assistant.on('audio-file', path => {
            let fileName = path.split('/').pop();
            allConfig.debug('New audio file', path);
            try {
                var params = { ACL: 'public-read', Bucket: 'echo-assistant', Key: fileName, Body: fs.createReadStream(path) };
                s3.upload(params, (err, data) => {
                    allConfig.debug('New audio file uploaded to S3', data, err);
                    if (!err) {
                        allConfig.debug(':tell', `<audio src="${data.Location}" />`);
                        context.emit(':tell', `<audio src="${data.Location}" />`);
                    }
                });
            }
            catch (e) {
                allConfig.error('Exception while trying to upload to S3', e);
            }
        });
        if (TESTING) {
            assistant.requestAssistant(fs.createReadStream('./resources/speech_test.pcm'));
        }
        else {
            sendAudio(query, assistant);
        }
    });
    auth.on('token-needed', () => {
        context.emit(':tell', 'Token needed');
    });
    auth.loadCredentials(ACCESS_TOKEN);
};
if (TESTING)
    callAssistant('hello', { emit: (a, b) => allConfig.debug(a, b) }, undefined);
const handlers = {
    'LaunchRequest': function () {
        if (!assertConstants(this))
            return;
        const ACCESS_TOKEN = this.event.session.user.accessToken;
        if (!ACCESS_TOKEN)
            return this.emit(':tellWithLinkAccountCard', LINK_ACCOUNT);
        this.emit(':ask', 'How can I help you?');
    },
    'Assist': function () {
        const QUERY = this.event.request.intent.slots.query ? this.event.request.intent.slots.query.value : null;
        const ACCESS_TOKEN = this.event.session.user.accessToken;
        allConfig.debug('----- Start Assist query: ', QUERY, ' ------');
        if (!QUERY)
            return this.emit(':tell', 'No query found, please try again');
        if (!assertConstants(this))
            return;
        if (!ACCESS_TOKEN)
            return this.emit(':tellWithLinkAccountCard', LINK_ACCOUNT);
        callAssistant(QUERY, this, ACCESS_TOKEN);
    },
    'Unhandled': function () {
        allConfig.debug('----- Unhandled query -----', this.event.request);
        this.emit(':tell', UNHANDLED_RESP);
    }
};
exports.handler = function (event, context, callback) {
    const alexa = alexa_sdk_1.default.handler(event, context);
    alexa.registerHandlers(handlers);
    alexa.APP_ID = APP_ID;
    alexa.execute();
};
process.on('uncaughtException', (err) => {
    allConfig.error('uncaughtException', err);
});