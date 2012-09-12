#!/usr/bin/env python

# Import gevent monkey and patch everything
from gevent import monkey
monkey.patch_all(httplib=True)

# Import the rest
from django.core.handlers.wsgi import WSGIHandler as DjangoWSGIApp
from django.core.management import setup_environ
from gevent.wsgi import WSGIServer
import os, sys
from socketio import SocketIOServer
import settings

setup_environ(settings)

# If true, SocketIO is used
use_socketio = False

def runserver():
    # Create the server
    application = DjangoWSGIApp()
    address = settings.WSGI_IP, settings.WSGI_PORT
    if use_socketio:
        server = SocketIOServer( address, application, resource="socket.io")
    else:
        server = WSGIServer( address, application )
    # Run the server
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.stop()
        sys.exit(0)

if __name__ == '__main__':
    runserver()
