'use strict'
var WebSocketClient = require('websocket').client
var PlexAPI = require('plex-api')
var PlexAPICredentials = require('plex-api/node_modules/plex-api-credentials')
var EventEmitter = require('events')
var stateEmitter = new EventEmitter()

var wsclient = null
var plexClient = null
var plexUser = null
var plexToken = null

var reconnectInterval = 5000

var playerSessions = {}
var playerStates = {}

var firstRun = true

// Initialise application
module.exports.init = function() {
    console.log('[INITIALISE] Please wait...')
    appStart()
}

// Listening events
stateEmitter.on('PlexEvent', (event) => {
    console.log('[LISTENER] Homey session listener detected event')
    if (event.state === 'stopped') {
        console.log('[LISTENER] State detected : stopped')
        closedSessionHandler(event)
    }
    if (event.state === 'playing' || event.state === 'paused') {
        console.log('[LISTENER] State detected : playing | paused')
        openSessionHandler(event)
    } else {
        if (playerSessions[event.key]) {
            console.log('[ERROR] State detected is not playing | paused | stopped, ignoring...:', event.state)
        }
    }
})

// API triggered functions
module.exports.appRestart = function appRestart() {
    console.log('[RESTART] Plex notify detected new settings...')
    stateEmitter.emit('closeWebSocket')
    console.log('[RESTART] Closed any open websockets')
    console.log('[RESTART] Restarting Plex notify now...')
    appStart()
}

// Start application
function appStart() {
    if (!Homey.manager('settings').get('username') || !Homey.manager('settings').get('password') || !Homey.manager('settings').get('ip') || !Homey.manager('settings').get('port')) {
        firstRun = true
    } else {
        firstRun = false
    }
    if (!firstRun) {
        console.log('[START] Plex notify starting...')
            // Erase existing sessions
        playerSessions = {}
            // Erase existing states
        playerStates = {}
            // Commence startup
        loginPlex(getCredentials()).then(websocketListen).catch(function(error) {
            console.log('[ERROR] Plex notify error:', error)
        })
    } else {
        console.log('[ERROR] No settings found - please input settings and save them!')
    }
}

function getCredentials() {
    console.log('[CREDENTIALS] Plex notify retrieving credentials...')
    return {
        'plexUsername': Homey.manager('settings').get('username'),
        'plexPassword': Homey.manager('settings').get('password'),
        'plexIP': Homey.manager('settings').get('ip'),
        'plexPort': Homey.manager('settings').get('port'),
        'plexHttps': Homey.manager('settings').get('use_https'),
    }
}

function loginPlex(credentials) {
    console.log('[LOGIN] Plex notify attempting login...')
        // For debugging
        // console.log('[LOGIN] Using login credentials:')
        // console.log(credentials)
    plexUser = PlexAPICredentials({
        'username': credentials.plexUsername,
        'password': credentials.plexPassword
    })
    plexClient = new PlexAPI({
        'hostname': credentials.plexIP,
        'port': credentials.plexPort,
        'https': credentials.plexHttps,
        'authenticator': plexUser,
        'options': {
            'identifier': 'HomeyPlexNotify',
            'deviceName': 'Homey',
            'version': '1.0.4',
            'product': 'Plex Notify',
            'platform': 'Plex Home Theater',
            'device': 'Linux'
        }
    })
    plexUser.on('token', function(token) {
        console.log('[TOKEN] Waiting for token...')
        plexToken = token
        console.log('[TOKEN] Token found and saved')
            // For debugging
            // console.log('[TOKEN] Token found and saved:', token)
    })
    return plexClient.query('/').then(function(result) {
        console.log('[CANDY] Server Name: ' + result.MediaContainer.friendlyName)
        console.log('[CANDY] Server Version: ' + result.MediaContainer.version)
        return Promise.resolve()
    })
}

function websocketListen() {
    wsclient = new WebSocketClient({tlsOptions: {rejectUnauthorized: false}});
    wsclient.on('connectFailed', function(error) {
        console.log('[WEBSOCKET] Error: ' + error.toString())
        setTimeout(websocketListen, reconnectInterval)
    })
    wsclient.on('connect', function(connection) {
        console.log('[WEBSOCKET] Connected')
        connection.on('error', function(error) {
            console.log('[WEBSOCKET] Error: ' + error.toString())
            setTimeout(websocketListen, reconnectInterval)
        })
        connection.on('close', function() {
            console.log('[WEBSOCKET] Closed')
            setTimeout(websocketListen, reconnectInterval)
        })
        connection.on('message', function(message) {
            if (message.type === 'utf8') {
                try {
                    // console.log('[WEBSOCKET] Incoming message: ', message)
                    var parsed = JSON.parse(message.utf8Data)
                        // console.log('[WEBSOCKET] Parsed: ', parsed)
                    var data = parsed.NotificationContainer
                        // console.log('[WEBSOCKET] Data: ', data)
                    var type = data.type
                        // console.log('[WEBSOCKET] Type: ', type)
                    if (type === 'playing') {
                        console.log('[WEBSOCKET] Detected session:')
                        console.log(data.PlaySessionStateNotification)
                        console.log('[WEBSOCKET] Detected state: ', data.PlaySessionStateNotification[0].state)
                        stateEmitter.emit('PlexEvent', {
                            'state': data.PlaySessionStateNotification[0].state,
                            'key': data.PlaySessionStateNotification[0].sessionKey
                        })
                    }
                } catch (e) {
                    console.error(e)
                }
            }
        })
    })
    var ws_proto = plexClient.https ? 'wss' : 'ws';
    wsclient.connect(ws_proto + '://' + plexClient.hostname + ':' + plexClient.port + '/:/websockets/notifications?X-Plex-Token=' + plexToken)
}

function closedSessionHandler(event) {
    // Check to ensure the session is valid (PHT sometimes sends multiple stop events!)
    if (playerSessions[event.key]) {
        // Trigger stopped flow card
        triggerFlow(event.state, playerSessions[event.key])
        console.log('[STOPPED SESSION HANDLER]', playerSessions[event.key].title, 'stopped playing - cleaning sessions / states for', playerSessions[event.key].player)
            // Delete state and session
        delete playerStates[playerSessions[event.key].player]
        delete playerSessions[event.key]
    } else {
        console.log('[STOPPED SESSION HANDLER, ERROR] No valid session found for stopped event:')
        console.log(event)
    }
}

function openSessionHandler(event) {
    plexClient.query('/status/sessions/').then(function(result) {
        console.log('[OPEN SESSION HANDLER] Retrieved Plex sessions:', result)
        console.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' State:', event.state)
            // Check for valid container
        if (result.MediaContainer.Video) {
            var container = result.MediaContainer.Video
        } else if (result.MediaContainer.Metadata) {
            var container = result.MediaContainer.Metadata
        } else {
            Homey.log('[OPEN SESSION HANDLER, ERROR] No valid container found')
            return
        }
        var session = container.filter(item => item.sessionKey === event.key)
            // Check for the valid session
        if (!session) {
            Homey.log('[OPEN SESSION HANDLER, ERROR] No valid session found')
            return
        }
        console.log('[OPEN SESSION HANDLER] Session:')
        console.log(session)
        console.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' Player:', session[0].Player.title)
        console.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' Title:', session[0].title)
        console.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' Type:', session[0].type)
        console.log('[OPEN SESSION HANDLER] ' + 'Session:', event.key + ' User:', session[0].User.title)
        playerSessions[event.key] = {
            'player': session[0].Player.title,
            'title': session[0].title,
            'type': session[0].type,
            'user': session[0].User.title
        }
        console.log('[OPEN SESSION HANDLER] Active player sessions:')
        console.log(playerSessions)
        console.log('[OPEN SESSION HANDLER] Active player States:')
        console.log(playerStates)
        if (playerStates[session[0].Player.title] != event.state) {
            console.log('[OPEN SESSION HANDLER] State changed? YES')
            playerStates[session[0].Player.title] = event.state
                // Trigger flow card
            triggerFlow(event.state, playerSessions[event.key])
        } else {
            console.log('[OPEN SESSION HANDLER] State changed? NO')
            playerStates[session[0].Player.title] = event.state
        }
    }, function(err) {
        console.log('[OPEN SESSION HANDLER, ERROR] Could not connect to server:', err)
    })
}

function triggerFlow(newState, tokens) {
    console.log('[TRIGGER FLOW] State:', newState)
    console.log('[TRIGGER FLOW] Tokens:')
    console.log(tokens)
    triggerFlowHelper(newState, tokens)
}

function triggerFlowHelper(eventName, tokens, callback) {
    console.log('[TRIGGER FLOW] ' + 'State: ' + eventName + ' | ' + 'Tokens:', tokens)
    Homey.manager('flow').trigger(eventName, tokens, null, callback)
}

// Condition cards

Homey.manager('flow').on('condition.is_playing', function(callback, args) {
    var playing_boolean = playerStates[args.player] === 'playing'
    console.log("Playing boolean: " + args.player + " is " + playing_boolean)
    Homey.log("[CONDITION FLOW] Is | Is not playing?: " + args.player + " is playing '" + playing_boolean + "'")
    callback(null, playing_boolean)
})

Homey.manager('flow').on('condition.is_paused', function(callback, args) {
    var paused_boolean = playerStates[args.player] === 'paused'
    console.log("Playing boolean: " + args.player + " is " + paused_boolean)
    Homey.log("[CONDITION FLOW] Is | Is not paused?: " + args.player + " is playing '" + paused_boolean + "'")
    callback(null, paused_boolean)
})
