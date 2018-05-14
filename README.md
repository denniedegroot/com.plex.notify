# Plex notify

This app lets you trigger flows based on Plex player activities.

## What trigger cards are available?

* Play
* Pause
* Stop

## What conditon cards are available?

* Playing
* Paused

The app uses tokens that support the following: player name, media title, plex username, media type.

## FAQ

* Which version of the plex-server do I need?

  * Plex media servers equal or higher than 1.3.0 should work

* I have an https-only server, or want to use https.

  * First, find the plex unique address that looks something like this (`https://10-1-2-3.abcdef.....plex.direct:32400`).
    You can find that by launching the plex app via [plex.tv](https://app.plex.tv/).
    Look in your browser developer console for the plex-server you are looking for. It should near the top prefixed with `[Connections]`.
    Use this address for the address you are connecting to plex with, not your local plex ip.
    Reason being, https certificates needs to be trusted. Then finally, enable `https` on your plex connection in Homey :)

## CHANGELOG

v1.0.4

* Adding `https` setting, in case you have forced ssl/tls enabled on your plex.

v1.0.3

* Added 'type' token to flow cards
* Added help tip to flow cards to explain options
* Removed confidential tokens / credentials from debug info (To avoid issues should people post the output of their debug in the public domain)
* Improved debug logging

v1.0.2

* Added 'playing' and 'paused' condition cards
