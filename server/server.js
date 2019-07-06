module.exports = function(server, storage) {
    var io = require('socket.io')(server);

    var clientSocketMap = {};

    io.on('connection', function (socket) {
        var userId = undefined;
        var nickname = undefined;

        socket.on('greeting', function(userInfo, callback) {
            userId = userInfo.id;
            nickname = userInfo.nickname;

            if (userId === undefined) return;

            clientSocketMap[userId] = socket;

            storage.logUserMessage(userId, 'greeting', userInfo)
            .then(function() {
                return storage.clearOldEdges(userId);
            })
            .then(function() {
                return storage.setNickname(userId, nickname);
            })
            .then(function() {
                return storage.getUndelivered(userId);
            })
            .then(function(messages) {
                if (messages && messages.length > 0) {
                    var msgList = messages.map(function(msg) {
                        return {
                            user: msg.user,
                            body: msg.body,
                            date: msg.date
                        };
                    });

                    socket.emit('messages', msgList, function() {
                        storage.clearUndelivered(userId)
                        .then(function() {
                            if (callback instanceof Function) callback();
                        });
                    });
                }
            });

          notifyGraphChange(userId);
        });

        function notifyGraphChange(userId) {
            return storage.graphTraversal(userId)
            .then(function(graph) {
                var msg = {
                    size: graph.vertices.length,
                    edgeCount: graph.edgeCount
                };

                graph.vertices.forEach(function(clientId) {
                    if (clientId in clientSocketMap) {
                        clientSocketMap[clientId].emit('chatinfo', msg);
                    }
                });

                return storage.logServerMessage(graph.vertices, 'chatinfo', msg);
            });
        }

        socket.on('found', function(neighbor, callback) {
            if (userId === undefined) return;
            if (callback instanceof Function) callback();

            storage.logUserMessage(userId, 'found', neighbor)
            .then(function() {
                return storage.createEdge(userId, neighbor);
            })
            .then(function() {
                return notifyGraphChange(userId);
            });
        });

        socket.on('lost', function(neighbor, callback) {
            if (userId === undefined) return;
            if (callback instanceof Function) callback();

            storage.logUserMessage(userId, 'lost', neighbor)
            .then(function() {
                return storage.disruptEdge(userId, neighbor);
            });
        });

        socket.on('refreshchatinfo', function(_, callback) {
            if (userId === undefined) return;
            if (callback instanceof Function) callback();

            notifyGraphChange(userId);
        });

        socket.on('chatmessage', function(messageBody, callback) {
            if (userId === undefined) return;

            if (callback instanceof Function) callback();

            var message = {
                user: nickname,
                body: messageBody
            };

            var date = new Date();

            storage.logUserMessage(userId, 'chatmessage', messageBody)
            .then(function() {
                return storage.addMessage(userId, message);
            })
            .then(function() {
                return storage.graphTraversal(userId);
            })
            .then(function(graph) {
                graph.vertices.forEach(function(clientId) {
                    if (clientId != userId) {
                        storage.addUndelivered(clientId, message.id)
                        .then(function() {
                            if (clientId in clientSocketMap) {
                                var msg = {
                                    user: message.user,
                                    body: message.body,
                                    date: date
                                };
                                clientSocketMap[clientId].emit('messages', [msg], function() {
                                    storage.removeUndelivered(clientId, message.id);
                                });
                            }
                        });
                    }
                });
            });
        });

        socket.on('disconnect', function () {
            if (userId !== undefined) {
                delete clientSocketMap[userId];
                storage.dropOut(userId);
            }
        });
    });

    return io;
};
