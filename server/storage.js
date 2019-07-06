module.exports = function(mongoUrl, options) {
    var mongodb = require('mongodb'),
        extend  = require('extend'),
        Promise = require('bluebird');
    var MongoClient = mongodb.MongoClient;
    var ObjectId = mongodb.ObjectId;

    var clientMaxTimeout = (options && options.clientMaxTimeout) || 1000 * 60 * 15;

    var db;

    var users    = function() { return db.collection('users'); };
    var messages = function() { return db.collection('messages'); };
    var edges    = function() { return db.collection('edges'); };

    var uFilter = function(userId) {
        return { _id: userId };
    };

    var acceptableDateInPast = function() {
        return new Date(Date.now() - clientMaxTimeout);
    };

    var pairVertices = function(userId1, userId2) {
        if (userId1.localeCompare(userId2) < 0) {
            return {
                vertexA: userId1,
                vertexB: userId2
            };
        }
        else {
            return {
                vertexA: userId2,
                vertexB: userId1
            };
        }
    };

    return MongoClient.connect(mongoUrl, {
        promiseLibrary: Promise
    })
    .then(function(database) {
        db = database;
        
        return edges().createIndex({
            vertexA: 1,
            vertexB: 1
        });
    })
    .then(function() {
        return {
            setNickname: function(userId, nickname) {
                return users().updateMany({_id: userId, disconnectDate: {$lt: acceptableDateInPast()}}, {
                    $set: {
                        undelivered: []
                    }
                })
                .then(function() {
                    return users().updateOne(uFilter(userId), {
                        $set: {
                            nickname: nickname,
                            disconnectDate: null
                        }
                    },
                    { upsert: true });
                });
            },

            dropOut: function(userId) {
                return users().updateOne({_id: userId}, {
                    $currentDate: {
                        disconnectDate: true
                    }
                })
                .then(function() {
                    var filter = {
                        $or: [
                            { vertexA: userId },
                            { vertexB: userId }
                        ]
                    };
                    
                    return edges().updateMany(filter, {
                        $currentDate: { disruptDate: true }
                    });
                });
            },

            getUndelivered: function(userId) {
                return users().find(uFilter(userId)).project({ undelivered: true }).limit(1).next()
                .then(function (user) {
                   if (user.undelivered) {
                       return messages().find({ _id: {$in: user.undelivered}}).toArray();
                   }
                   else {
                       return [];
                   }
                })
                .then(function(msgList) {
                    var msgMap = {};

                    var resultList = [];
                    
                    msgList.forEach(function(msg) {
                        msg.id = msg._id;
                        delete msg._id;
                        resultList.push(msg);
                    });

                    return resultList.sort(function(a, b) {
                        return a.date.getTime() - b.date.getTime();
                    });
                });
            },

            addUndelivered: function(userId, messageId) {
                return users().updateOne(uFilter(userId), {
                    $push: {
                        undelivered: messageId
                    }
                });
            },

            clearUndelivered: function(userId) {
                return users().updateOne(uFilter(userId), {
                    $set: {
                        undelivered: []
                    }
                });
            },

            removeUndelivered: function(userId, messageId) {
                return users().updateOne(uFilter(userId), {
                    $pull: {
                        undelivered: messageId
                    }
                });
            },

            addMessage: function(userId, message) {
                message.id = new ObjectId();

                return messages().insertOne({
                    _id: message.id,
                    userId: userId,
                    user: message.user,
                    date: new Date(),
                    body: message.body
                });
            },

            createEdge: function(userId1, userId2) {
                return edges().updateOne(pairVertices(userId1, userId2), extend(pairVertices(userId1, userId2), {
                    disruptDate: null
                }),
                { upsert: true });
            },

            disruptEdge: function(userId1, userId2) {
                return edges().updateOne(pairVertices(userId1, userId2), {
                    $currentDate: { disruptDate: true }
                });
            },

            clearOldEdges: function(userId) {
                return edges().deleteMany({
                    $and: [
                        {
                            $or: [
                                { vertexA: userId },
                                { vertexB: userId }
                            ]
                        },
                        {
                            disruptDate: {$lt: acceptableDateInPast()}
                        }
                    ]
                });
            },

            graphTraversal: function(userId) {
                return new Promise(function(resolve, reject) {
                    var userSet = {};
                    userSet[userId] = true;

                    var edgeSet = {};

                    var oldestDisruptDate = acceptableDateInPast();
                
                    var impl = function(userIdList) {
                        var filter = {
                            $and: [
                                {
                                    $or: [
                                        { vertexA: {$in: userIdList} },
                                        { vertexB: {$in: userIdList} }
                                    ]
                                },
                                {
                                    $or: [
                                        { disruptDate: null },
                                        { disruptDate: {$gt: oldestDisruptDate}},
                                    ]
                                }
                            ]
                        };

                        edges().find(filter).project({vertexA: true, vertexB: true}).toArray()
                        .then(function(edgeList) {
                            var newUserIdList = [];

                            if (edgeList) {
                                edgeList.forEach(function(edge) {
                                    if (!(edge.vertexA in userSet)) {
                                        newUserIdList.push(edge.vertexA);
                                        userSet[edge.vertexA] = true;
                                    }
                                    else if(!(edge.vertexB in userSet)) {
                                        newUserIdList.push(edge.vertexB);
                                        userSet[edge.vertexB] = true;
                                    }

                                    edgeSet[edge.vertexA + ':' + edge.vertexB] = true;
                                });
                            }

                            if (newUserIdList.length > 0) {
                                impl(newUserIdList);
                            }
                            else {
                                var vertices = [];
                                for (var user in userSet) {
                                    vertices.push(user);
                                }
                                
                                resolve({
                                    edgeCount: Object.keys(edgeSet).length,
                                    vertices: vertices
                                });
                            }
                        }, reject);
                    };

                    impl([userId]);
                });
            },

            logUserMessage: function(userId, type, body) {
                return db.collection('userlog').insertOne({
                    userId: userId,
                    type: type,
                    body: body
                });
            },

            logServerMessage: function(userId, type, body) {
                if (Array.isArray(userId)) {
                    var batch = db.collection('serverlog').initializeUnorderedBulkOp();

                    userId.forEach(function(id) {
                        batch.insert({
                            userId: id,
                            type: type,
                            body: body
                        });
                    });

                    return batch.execute();
                }
                else {
                    return db.collection('serverlog').insertOne({
                        userId: userId,
                        type: type,
                        body: body
                    });
                }
            },

            clearDb: function() {
                return db.collection('users').remove({})
                    .then(function() {
                        return db.collection('messages').remove({});
                    })
                    .then(function() {
                        return db.collection('edges').remove({});
                    })
                    .then(function() {
                        return db.collection('userlog').remove({});
                    })
                    .then(function() {
                        return db.collection('serverlog').remove({});
                    });
            },

            close: function() {
                db.close();
            }
        };
    });
};
