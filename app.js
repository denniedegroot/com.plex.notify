'use strict'

const Homey = require('homey');

var WebSocketClient = require('websocket').client
var PlexAPI = require('plex-api')
var PlexAPICredentials = require('plex-api/node_modules/plex-api-credentials')
var EventEmitter = require('events')

const reconnectInterval = 5000

class App extends Homey.App {

    onInit() {
        this.flowTriggers = {}
        this.playerStates = {}
        this.playerSessions = {}
        this.wsClient = null
        this.plexClient = null
        this.plexUser = null
        this.plexToken = null
        this.reconnectInProgress = false
        this.stateEmitter = new EventEmitter()

        this._onFlowConditionPlaying = this._onFlowConditionPlaying.bind(this);
        this._onFlowConditionPaused = this._onFlowConditionPaused.bind(this);

        Homey.ManagerSettings.on('set', this._onSetSettings.bind(this));

        this.log(`${Homey.manifest.id} running...`);

        this.plexLogin(this.getCredentials()).then(this.websocketListen.bind(this)).catch((error) => {
            this.error('plexLogin', error);
        });

        this.flowTriggers['playing'] = new Homey.FlowCardTrigger('playing');
        this.flowTriggers['stopped'] = new Homey.FlowCardTrigger('stopped');
        this.flowTriggers['paused'] = new Homey.FlowCardTrigger('paused');

        new Homey.FlowCardCondition('is_playing')
            .register()
            .registerRunListener( this._onFlowConditionPlaying );

        new Homey.FlowCardCondition('is_paused')
            .register()
            .registerRunListener( this._onFlowConditionPaused );

        this.stateEmitter.on('PlexEvent', (event) => {
            this.log('[LISTENER] Homey session listener detected event')
            if (event.state === 'stopped') {
                this.log('[LISTENER] State detected : stopped')
                this.closedSessionHandler(event)
            }
            if (event.state === 'playing' || event.state === 'paused') {
                this.log('[LISTENER] State detected : playing | paused')
                this.openSessionHandler(event)
            } else {
                if (this.playerSessions[event.key]) {
                    this.error('[ERROR] State detected is not playing | paused | stopped, ignoring...:', event.state)
                }
            }
        })
    }

    _onFlowConditionPlaying(args) {
        let playing_boolean = this.playerStates[args.player] === 'playing'
        this.log("Playing boolean: " + args.player + " is " + playing_boolean)
        this.log("[CONDITION FLOW] Is | Is not playing?: " + args.player + " is playing '" + playing_boolean + "'")

        return playing_boolean;
    }

    _onFlowConditionPaused(args) {
        var paused_boolean = this.playerStates[args.player] === 'paused'
        this.log("Playing boolean: " + args.player + " is " + paused_boolean)
        this.log("[CONDITION FLOW] Is | Is not paused?: " + args.player + " is playing '" + paused_boolean + "'")

        return paused_boolean;
    }

    _onSetSettings(name) {
        console.log('_onSetSettings', name);

        if (this.reconnectInProgress)
            return

        this.reconnectInProgress = true

        // Wait until all settings are set and then reconnect
        setTimeout(() => {
            this.wsClient = null
            this.plexClient = null

            this.plexLogin(this.getCredentials()).then(this.websocketListen.bind(this)).catch((error) => {
                this.error('plexLogin', error)
            });

            this.reconnectInProgress = false
        }, 3000);
    }

    getCredentials() {
        return {
            'plexUsername': Homey.ManagerSettings.get('username'),
            'plexPassword': Homey.ManagerSettings.get('password'),
            'plexIP': Homey.ManagerSettings.get('ip'),
            'plexPort': Homey.ManagerSettings.get('port'),
            'plexHttps': Homey.ManagerSettings.get('use_https'),
        }
    }

    plexLogin(credentials) {
        if (Homey.ManagerSettings.get('username') &&
            Homey.ManagerSettings.get('password') &&
            Homey.ManagerSettings.get('ip') &&
            Homey.ManagerSettings.get('port')) {

            this.playerStates = {}
            this.playerSessions = {}

            this.plexUser = PlexAPICredentials({
                'username': credentials.plexUsername,
                'password': credentials.plexPassword
            });

            this.plexClient = new PlexAPI({
                'hostname': credentials.plexIP,
                'port': credentials.plexPort,
                'https': credentials.plexHttps,
                'authenticator': this.plexUser,
                'options': {
                    'identifier': 'HomeyPlexNotify',
                    'deviceName': 'Homey',
                    'version': '1.0.4',
                    'product': 'Plex Notify',
                    'platform': 'Plex Home Theater',
                    'device': 'Linux'
                }
            });

            this.plexUser.on('token', (token) => {
                this.log('[TOKEN] Waiting for token...')
                this.plexToken = token
                this.log('[TOKEN] Token found and saved')
            });

            return this.plexClient.query('/').then((result) => {
                this.log('[PLEX] Server Name: ' + result.MediaContainer.friendlyName)
                this.log('[PLEX] Server Version: ' + result.MediaContainer.version)
                return Promise.resolve();
            });
        } else {
            this.error('[ERROR] No settings found - please input settings and save them!')
            return Promise.reject();
        }
    }

    websocketListen() {
        this.wsclient = new WebSocketClient({tlsOptions: {rejectUnauthorized: false}});

        this.wsclient.on('connectFailed', (error) => {
            this.log('[WEBSOCKET] Error: ' + error.toString())
            setTimeout(this.websocketListen.bind(this), reconnectInterval)
        });

        this.wsclient.on('connect', (connection) => {
            this.log('[WEBSOCKET] Connected')

            connection.on('error', (error) => {
                this.error('[WEBSOCKET] Error: ' + error.toString())
                setTimeout(this.websocketListen.bind(this), reconnectInterval)
            });

            connection.on('close', () => {
                this.log('[WEBSOCKET] Closed')
                setTimeout(this.websocketListen.bind(this), reconnectInterval)
            });

            connection.on('message', (message) => {
                if (message.type === 'utf8') {
                    try {
                        // this.log('[WEBSOCKET] Incoming message: ', message)
                        let parsed = JSON.parse(message.utf8Data);
                            // this.log('[WEBSOCKET] Parsed: ', parsed)
                        let data = parsed.NotificationContainer;
                            // this.log('[WEBSOCKET] Data: ', data)
                        let type = data.type;
                            // this.log('[WEBSOCKET] Type: ', type)
                        if (type === 'playing') {
                            this.log('[WEBSOCKET] Detected session:')
                            this.log(data.PlaySessionStateNotification)
                            this.log('[WEBSOCKET] Detected state: ', data.PlaySessionStateNotification[0].state)
                            this.stateEmitter.emit('PlexEvent', {
                                'state': data.PlaySessionStateNotification[0].state,
                                'key': data.PlaySessionStateNotification[0].sessionKey
                            })
                        }
                    } catch (e) {
                        this.error(e);
                    }
                }
            });
        });

        let ws_proto = this.plexClient.https ? 'wss' : 'ws';
        this.wsclient.connect(ws_proto + '://' + this.plexClient.hostname + ':' + this.plexClient.port + '/:/websockets/notifications?X-Plex-Token=' + this.plexToken)
    }

    openSessionHandler(event) {
        this.plexClient.query('/status/sessions/').then((result) => {
            this.log('[OPEN SESSION HANDLER] Retrieved Plex sessions:', result)
            this.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' State:', event.state)
                // Check for valid container
            if (result.MediaContainer.Video) {
                var container = result.MediaContainer.Video
            } else if (result.MediaContainer.Metadata) {
                var container = result.MediaContainer.Metadata
            } else {
                this.log('[OPEN SESSION HANDLER, ERROR] No valid container found')
                return
            }
            var session = container.filter(item => item.sessionKey === event.key)
                // Check for the valid session
            if (!session) {
                this.log('[OPEN SESSION HANDLER, ERROR] No valid session found')
                return
            }
            this.log('[OPEN SESSION HANDLER] Session:')
            this.log(session)
            this.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' Player:', session[0].Player.title)
            this.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' Address:', session[0].Player.address)
            this.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' Title:', session[0].title)
            this.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' Type:', session[0].type)
            this.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' User:', session[0].User.title)
            this.log(this.playerSessions)
            this.playerSessions[event.key] = {
                'player': session[0].Player.title,
                'title': session[0].title,
                'type': session[0].type,
                'user': session[0].User.title,
                'address': session[0].Player.address
            }
            this.log('[OPEN SESSION HANDLER] Active player sessions:')
            this.log(this.playerSessions)
            this.log('[OPEN SESSION HANDLER] Active player States:')
            this.log(this.playerStates)
            if (this.playerStates[session[0].Player.title] != event.state) {
                this.log('[OPEN SESSION HANDLER] State changed? YES')
                this.playerStates[session[0].Player.title] = event.state
                this.playerStates[session[0].Player.address] = event.state
                // Trigger flow card
                this.triggerFlow(event.state, this.playerSessions[event.key])
            } else {
                this.log('[OPEN SESSION HANDLER] State changed? NO')
                this.playerStates[session[0].Player.title] = event.state
                this.playerStates[session[0].Player.address] = event.state
            }
        }, function(err) {
            this.error('[OPEN SESSION HANDLER, ERROR] Could not connect to server:', err)
        })
    }

    closedSessionHandler(event) {
        // Check to ensure the session is valid (PHT sometimes sends multiple stop events!)
        if (this.playerSessions[event.key]) {
            // Trigger stopped flow card
            this.triggerFlow(event.state, this.playerSessions[event.key])
            this.log('[STOPPED SESSION HANDLER]', this.playerSessions[event.key].title, 'stopped playing - cleaning sessions / states for', this.playerSessions[event.key].player)
                // Delete state and session
            delete this.playerStates[this.playerSessions[event.key].player]
            delete this.playerStates[this.playerSessions[event.key].address]
            delete this.playerSessions[event.key]
        } else {
            this.log('[STOPPED SESSION HANDLER, ERROR] No valid session found for stopped event:')
            this.log(event)
        }
    }

    triggerFlow(event, tokens) {
        this.log('[TRIGGER FLOW] State:', event)
        this.log('[TRIGGER FLOW] Tokens:')
        this.log(tokens)

        if (this.flowTriggers.hasOwnProperty(event)) {
            this.log('[TRIGGER FLOW] ' + 'State: ' + event + ' | ' + 'Tokens:', tokens)
            this.flowTriggers[event].register().trigger(tokens)
        }
    }
}

module.exports = App;
