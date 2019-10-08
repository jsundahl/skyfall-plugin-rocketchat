'use strict';

const { driver } = require('@rocket.chat/sdk');

driver.useLog({
  debug: () => { return null; },
  info: () => { return null; },
  warn: () => { return null; },
  warning: () => { return null; },
  error: () => { return null; }
});

function RocketChat(skyfall) {
  this.connection = null;

  this.channels = new Set([ 'general' ]);

  this.connect = (options) => {
    if (this.connection) {
      return this.connection;
    }

    const id = skyfall.utils.id();
    const name = options.username || options.host;
    let connected = false;

    if (options.channels) {
      if (Array.isArray(options.channels)) {
        this.channels = new Set(options.channels);
      } else {
        this.channels.add(this.channels);
      }
    }

    this.connection = {
      id,
      name,
      host: options.host,
      secure: Boolean(options.secure),
      username: options.username,
      userId: null,
      autoJoin: options.autoJoin !== undefined ? options.autoJoin : true,
      filter: options.filter !== undefined ? options.filter : true,
      get connected () {
        return connected;
      },
      get channels () {
        return Array.from(this.channels);
      }
    };

    skyfall.events.emit({
      type: `rocketchat:${ name }:connecting`,
      data: this.connection,
      source: id
    });

    skyfall.events.on(`rocketchat:${ name }:send`, (event) => {
      this.send(event.data);
    });

    return driver.connect({
      host: this.connection.host,
      useSsl: this.connection.secure
    }).
      then(() => {
        return driver.login({
          username: this.connection.username,
          password: options.password
        });
      }).
      then((userId) => {
        this.connection.userId = userId;
        return driver.joinRooms(Array.from(this.channels));
      }).
      then(() => {
        return driver.subscribeToMessages();
      }).
      then(() => {
        connected = true;

        skyfall.events.emit({
          type: `rocketchat:${ name }:connected`,
          data: this.connection,
          source: id
        });

        return driver.reactToMessages((error, message) => {
          if (error) {
            skyfall.events.emit({
              type: `rocketchat:${ name }:error`,
              data: error,
              source: id
            });
          } else if (message.u._id !== this.connection.userId) {
            driver.getRoomName(message.rid).
              then((roomName) => {
                if (roomName) {
                  message.roomName = `#${ roomName }`;
                  message.direct = false;
                } else {
                  message.roomName = null;
                  message.direct = true;
                }

                skyfall.events.emit({
                  type: `rocketchat:${ name }:message`,
                  data: message,
                  source: id
                });
              }).
              catch((error) => {
                skyfall.events.emit({
                  type: `rocketchat:${ name }:error`,
                  data: error,
                  source: id
                });
              });
          }
        });
      }).
      catch((error) => {
        skyfall.events.emit({
          type: `rocketchat:${ name }:error`,
          data: error,
          source: id
        });
      });
  };

  this.join = function(channel, ...channels) {
    if (Array.isArray(channel)) {
      channels.push(...channel);
    } else {
      channels.push(channel);
    }

    if (channels.length === 1) {
      return driver.joinRoom(channels[0]).
        then(() => {
          channels.forEach((chan) => { return this.channels.add(chan); });

          skyfall.events.emit({
            type: `rocketchat:${ this.connection.name }:joined`,
            data: { channel: channels[0] },
            source: this.connection.id
          });
        });
    }
    return driver.joinRooms(channels).
      then(() => {
        skyfall.events.emit({
          type: `rocketchat:${ this.connection.name }:joined`,
          data: { channels },
          source: this.connection.id
        });
      });
  };

  this.part = function(channel, ...channels) {
    if (Array.isArray(channel)) {
      channels.push(...channel);
    } else {
      channels.push(channel);
    }

    let chain = Promise.resolve();
    channels.forEach((chan) => {
      chain = chain.then(() => {
        return driver.leaveRoom(chan).
          then(() => {
            this.channels.delete(chan);

            skyfall.events.emit({
              type: `rocketchat:${ this.connection.name }:parted`,
              data: { channel: chan },
              source: this.connection.id
            });
          });
      });
    });

    return chain;
  };

  this.send = function({
    to, content
  }) {
    if (this.connection && this.connection.connected) {
      if (to && content) {
        let getRoomId;
        if (to.startsWith('@')) {
          getRoomId = driver.getDirectMessageRoomId(to.substring(1));
        } else {
          const room = to.startsWith('#') ? to.substring(1) : to;

          getRoomId = driver.getRoomId(room).
            then((roomId) => {
              if (this.connection.autoJoin && !this.channels.has(room)) {
                return this.join(room).
                  then(() => {
                    return roomId;
                  });
              }
              return roomId;
            });
        }

        getRoomId.
          then((roomId) => {
            const message = driver.prepareMessage(content, roomId);
            driver.sendMessage(message);
          }).
          catch((error) => {
            skyfall.events.emit({
              type: `rocketchat:${ this.connection.name }:error`,
              data: error,
              source: this.connection.id
            });
          });
      } else {
        skyfall.events.emit({
          type: `rocketchat:${ this.connection.name }:error`,
          data: new Error('messages must include to and content'),
          source: this.connection.id
        });
      }
    } else {
      skyfall.events.emit({
        type: `rocketchat:${ this.connection.name }:error`,
        data: new Error('not connected'),
        source: this.connection.id
      });
    }
  };
}

module.exports = {
  name: 'rocketchat',
  install: (skyfall, options) => {
    skyfall.rocketchat = new RocketChat(skyfall, options);
  }
};
