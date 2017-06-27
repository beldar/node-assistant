import {Config, AuthenticationConfig} from './client-config';
import {AssistantClient} from './assistant';
import {Authentication} from './authentication';
import fs = require('fs');
import { Polly, S3 } from 'aws-sdk';
import debug from'debug';
import {PassThrough} from 'stream';

const Alexa = require('alexa-sdk');

/** Constant declarations **/
const TESTING                 = process.env.TESTING || false,
      NOT_FOUND               = 'Sorry I don\'t know this command',
      UNHANDLED_RESP          = 'Are you talking to me?',
      ERROR_RESP              = 'Oops something went wrong',
      LINK_ACCOUNT            = 'You must link your Google account to use this skill. Please use the link in the Alexa app to authorise your Google Account.',
      AWS_REGION              = process.env.AWS_REGION || 'eu-west-1',
      AWS_S3_BUCKET           = process.env.AWS_S3_BUCKET,
      ASSISTANT_CLIENT_ID     = process.env.ASSISTANT_CLIENT_ID,
      ASSISTANT_CLIENT_SECRET = process.env.ASSISTANT_CLIENT_SECRET,
      REDIRECT_URL            = process.env.REDIRECT_URL,
      APP_ID                  = process.env.APP_ID;

const polly = new Polly({region: AWS_REGION});
const s3 = new S3({region: AWS_REGION});
const allConfig = new Config();

allConfig.debug = debug('node-assistant');
allConfig.error = debug('node-assistant:error');
allConfig.authentication = new AuthenticationConfig();
allConfig.authentication.clientId = ASSISTANT_CLIENT_ID;
allConfig.authentication.clientSecret = ASSISTANT_CLIENT_SECRET;
allConfig.authentication.codeRedirectUri = REDIRECT_URL;

if (process.env.DEBUG === 'node-assistant') {
  allConfig.verbose = true; // for other logging
}

const auth = new Authentication(allConfig);

const sendAudio = (text, assistant: AssistantClient, context) => {
  let params = {
    OutputFormat: "pcm",
    SampleRate: "16000",
    Text: text,
    TextType: "text",
    VoiceId: "Joanna"
  };

  polly.synthesizeSpeech(params)
    .on('httpHeaders', function(statusCode, headers) {
      if (statusCode < 300) {
        const stream = this.response.httpResponse.createUnbufferedStream();
        assistant.requestAssistant(stream, getS3Stream( context ));
      }
    })
    .on('error', (response) => allConfig.error('Error while querying Polly', response))
    .send();
};

const assertConstants = ( context ) => {
  if ( !AWS_S3_BUCKET ) {
    allConfig.debug('AWS_S3_BUCKET is not set');
    context.emit(':tell', 'Amazon S3 Bucket environmental variable is not set');
    return false;
  }

  if ( !ASSISTANT_CLIENT_ID ) {
    allConfig.debug('ASSISTANT_CLIENT_ID is not set');
    context.emit(':tell', 'Google Assistant Client ID environmental variable is not set');
    return false;
  }

  if ( !ASSISTANT_CLIENT_SECRET ) {
    allConfig.debug('ASSISTANT_CLIENT_SECRET is not set');
    context.emit(':tell', 'Google Assistant Client Secret environmental variable is not set');
    return false;
  }

  if ( !REDIRECT_URL ) {
    allConfig.debug('REDIRECT_URL is not set');
    context.emit(':tell', 'Redirect URL environmental variable is not set');
    return false;
  }

  return true;
};

const getS3Stream = function( context ) {
  const pass = new PassThrough();
  const fileName = Date.now() + '.mp3';
  const params = {ACL:'public-read', Bucket: AWS_S3_BUCKET, Key: fileName, Body: pass};
  s3.upload(params, (err, data) => {
    allConfig.debug('New audio file uploaded to S3', data, err);
    if (!err) {
      allConfig.debug(':tell', `<audio src="${data.Location}" />`);
      context.emit(':tell', `<audio src="${data.Location}" />`);
    }
  });
  return pass;
};

const callAssistant = function(query, context, ACCESS_TOKEN) {
  auth.on('oauth-ready', (oauth2Client) => {
    const assistant = new AssistantClient(allConfig, oauth2Client);

    allConfig.debug('Call assistant', query);

    sendAudio(query, assistant, context);
  });

  auth.loadCredentials(ACCESS_TOKEN);
};

if ( TESTING ) {
  const query = 'hello';
  const context = { emit: (a,b)=> allConfig.debug(a,b) };
  const client = require('googleapis').google.auth.OAuth2;
  client.setCredentials(require('./creds.json'));
  const assistant = new AssistantClient(allConfig, client);
  assistant.requestAssistant(fs.createReadStream('./resources/speech_test.pcm'), getS3Stream( context ));
}

export const handlers = {
  'LaunchRequest': function() {
    allConfig.debug('---- LaunchRequest handler');

    if (assertConstants( this )) {
      allConfig.debug('All env vars are set');
      const ACCESS_TOKEN = this.event.session.user.accessToken;
      if (!ACCESS_TOKEN) {
        allConfig.debug('Access Token not found, tellWithLinkAccountCard', LINK_ACCOUNT);
        this.emit(':tellWithLinkAccountCard', LINK_ACCOUNT);
      } else {
        allConfig.debug('Access Token found, carry on');
        this.emit(':ask', 'How can I help you?');
      }
    } else {
      allConfig.debug('Some env vars are NOT set!');
    }
  },

  'Assist': function () {
    const QUERY = this.event.request.intent.slots.query ? this.event.request.intent.slots.query.value : null;
    const ACCESS_TOKEN = this.event.session.user.accessToken;

    allConfig.debug('---- Assist handler', QUERY);

    if (!QUERY) {
      this.emit(':tell', 'No query found, please try again');
    } else if (assertConstants( this )) {
      if (!ACCESS_TOKEN) {
        allConfig.debug('Access Token not found, tellWithLinkAccountCard', LINK_ACCOUNT);
        this.emit(':tellWithLinkAccountCard', LINK_ACCOUNT);
      } else {
        allConfig.debug('Access Token found, carry on');
        callAssistant(QUERY, this, ACCESS_TOKEN);
      }
    } else {
      allConfig.debug('Some env vars are NOT set!');
    }
  },

  'Unhandled': function() {
    allConfig.debug('----- Unhandled query -----', this.event.request);
    this.emit(':tell', UNHANDLED_RESP);
  }
};

exports.handler = function(event, context, callback) {
  const alexa = Alexa.handler(event, context);
  alexa.appId = APP_ID;
  alexa.registerHandlers(handlers);
  alexa.execute();
};

process.on('uncaughtException', (err) => {
  allConfig.error('uncaughtException', err);
});
