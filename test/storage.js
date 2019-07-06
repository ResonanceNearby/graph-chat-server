var MongoClient = require('mongodb').MongoClient,
    should      = require('should'),
    Promise     = require('bluebird');

describe('Storage', function() {
    this.timeout(1000);

    var mongoUrl = 'mongodb://localhost/test';
    var storage, db;
    
    before(function(){
        return require('../server/storage.js')(mongoUrl)
        
        .then(function(obj) {
            storage = obj;
            return MongoClient.connect(mongoUrl, {
                promiseLibrary: Promise
            });
        })
        
        .then(function(obj) {
            db = obj;
        });
    });

    beforeEach(function() {
        return storage.clearDb();
    });


    it('setNickname', function(done) {
        storage.setNickname('test-unique-id-1', 'Guest')
        
        .then(function() {
            return db.collection('users').find({}).toArray();
        })
        
        .then(function(users) {
            users.should.have.lengthOf(1);

            var guest = users[0];

            guest.should.have.property('_id').equal('test-unique-id-1');
            guest.should.have.property('nickname').equal('Guest');
            guest.should.have.property('disconnectDate').null();
        })
        
        .then(done, done);
    });

    it('should set disconnectDate when user drop out', function(done) {
        db.collection('users').insertOne({
            _id: 'test-unique-id-1'
        })

        .then(function() {
            return storage.dropOut('test-unique-id-1');
        })

        .then(function() {
            return db.collection('users').find({
                _id: 'test-unique-id-1'
            }).limit(1).next();
        })

        .then(function(user) {
            user.should.have.property('_id').equal('test-unique-id-1');
            user.should.have.property('disconnectDate').Date();

        })

        .then(done, done);
    });

    it('should disrupts all user links when user drop out', function(done) {
        db.collection('users').insertMany([
            { _id: 'test-unique-id-1' },
            { _id: 'test-unique-id-2' },
            { _id: 'test-unique-id-3' }
        ])

        .then(function() {
            return db.collection('edges').insertMany([
                {
                    vertexA: 'test-unique-id-1',
                    vertexB: 'test-unique-id-2'
                },
                {
                    vertexA: 'test-unique-id-2',
                    vertexB: 'test-unique-id-3'
                }
            ]);
        })

        .then(function() {
            return storage.dropOut('test-unique-id-2');
        })

        .then(function() {
            return db.collection('edges').find({vertexA: 'test-unique-id-1'}).limit(1).next();
        })
        .then(function(edge) {
            edge.should.have.property('disruptDate').Date();
        })


        .then(function() {
            return db.collection('edges').find({vertexB: 'test-unique-id-3'}).limit(1).next();
        })
        .then(function(edge) {
            edge.should.have.property('disruptDate').Date();
        })


        .then(done, done);
        
    });

    it('should return a empty undelivered list when there are no messages', function(done) {
        var now = new Date();
        
        db.collection('users').insertOne({
            _id: 'test-unique-id-1'
        })
        
        .then(function() {
            return storage.getUndelivered('test-unique-id-1');
        })
        
        .then(function(undelivered) {
            undelivered.should.be.deepEqual([]);
        })
        
        .then(done, done);
    });

    it('should return correct undelivered list', function(done) {
        var now = new Date();
        
        db.collection('users').insertOne({
            _id: 'test-unique-id-1',
            undelivered: ['msg-1', 'old-message', 'msg-2', 23]
        })
        
        .then(function() {
            return db.collection('messages').insert([
                {_id: 'msg-1', body: 'message-1', date: new Date(now.getTime() + 1)},
                {_id: 'msg-2', body: 'message-2', date: new Date(now.getTime() + 2)},
                {_id: 23, body: '23', date: new Date(now.getTime() + 3)},
                {_id: 'old-message', body: 'nothing', date: new Date(now - 1000 * 60 * 30)}
            ]);
        })

        .then(function() {
            return storage.setNickname('test-unique-id-1', 'Guest');
        })
        
        .then(function() {
            return storage.getUndelivered('test-unique-id-1');
        })
        
        .then(function(undelivered) {
            undelivered.should.be.deepEqual([
                {id: 'old-message', body: 'nothing', date: new Date(now - 1000 * 60 * 30)},
                {id: 'msg-1', body: 'message-1', date: new Date(now.getTime() + 1)},
                {id: 'msg-2', body: 'message-2', date: new Date(now.getTime() + 2)},
                {id: 23, body: '23', date: new Date(now.getTime() + 3)}
            ]);
        })
        
        .then(done, done);
    });

    it('should clear undelivered list when user connect after big timeout', function(done) {
        var now = new Date();
        
        db.collection('users').insertOne({
            _id: 'test-unique-id-1',
            disconnectDate: new Date(Date.now() - 1000 * 60 * 20),
            undelivered: ['msg-1', 'old-message', 'msg-2', 23]
        })

        .then(function() {
            return db.collection('messages').insert([
                {_id: 'msg-1', body: 'message-1', date: new Date(now.getTime() + 1)},
                {_id: 'msg-2', body: 'message-2', date: new Date(now.getTime() + 2)},
                {_id: 23, body: '23', date: new Date(now.getTime() + 3)},
                {_id: 'old-message', body: 'nothing', date: new Date(now - 1000 * 60 * 30)}
            ]);
        })
        
        .then(function() {
            return storage.setNickname('test-unique-id-1', 'Guest');
        })

        .then(function() {
            return storage.getUndelivered('test-unique-id-1');
        })
        
        .then(function(undelivered) {
            undelivered.should.be.deepEqual([]);
        })

        .then(done, done);
        
    });


    it('addUndelivered 1', function(done) {
        db.collection('users').insertOne({
            _id: 'test-unique-id-1',
            undelivered: [1, 2, 3]
        })
        .then(function() {
            return storage.addUndelivered('test-unique-id-1', 'msg-4');
        })
        .then(function() {
            return db.collection('users').find({}).toArray();
        })
        .then(function(users) {
            users[0].should.have.property('undelivered').deepEqual([1, 2, 3, 'msg-4']);
        })
        .then(done, done);
    });

    it('addUndelivered 2', function(done) {
        db.collection('users').insertOne({
            _id: 'test-unique-id-1'
        })
        
        .then(function() {
            return storage.addUndelivered('test-unique-id-1', 'msg-id');
        })
        
        .then(function() {
            return db.collection('users').find({}).toArray();
        })
        
        .then(function(users) {
            users[0].should.have.property('undelivered').deepEqual(['msg-id']);
        })
        
        .then(done, done);
    });


    it('clearUndelivered', function(done) {
        db.collection('users').insertOne({
            _id: 'test-unique-id-1',
            undelivered: [1, 2, 3]
        })
        .then(function() {
            return storage.clearUndelivered('test-unique-id-1');
        })
        .then(function() {
            return db.collection('users').find({}).toArray();
        })
        .then(function(users) {
            users.should.be.lengthOf(1);

            var user = users[0];

            user.should.be.have.property('_id').equal('test-unique-id-1');
            user.should.be.have.property('undelivered').deepEqual([]);
        })
        .then(done, done);
    });

    it('removeUndelivered', function(done) {
        db.collection('users').insertOne({
            _id: 'test-unique-id-1',
            undelivered: ['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5']
        })
        .then(function() {
            return storage.removeUndelivered('test-unique-id-1', 'msg-4');
        })
        .then(function() {
            return db.collection('users').find({}).limit(1).next();
        })
        .then(function(user) {
            user.should.be.have.property('_id').equal('test-unique-id-1');
            user.should.be.have.property('undelivered').deepEqual(['msg-1', 'msg-2', 'msg-3', 'msg-5']);
        })
        .then(done, done);
    });

    it('addMessage', function(done) {
        var message = {
            user: 'anonymous',
            body: 'Test chat message!'
        };
        
        storage.setNickname('test-user-1', 'Guest1')
        
        .then(function() {
            return storage.setNickname('test-user-2', 'Guest2');
        })
        
        .then(function() {
            return storage.addMessage('test-user-1', message);
        })
        
        .then(function() {
            message.should.be.have.property('id');

            return storage.addUndelivered('test-user-2', message.id);
        })
        
        .then(function() {
            return storage.getUndelivered('test-user-2');
        })
        
        .then(function(messages) {
            messages.should.be.lengthOf(1);

            var msg = messages[0];

            msg.should.be.have.property('id').deepEqual(message.id);
            msg.should.be.have.property('userId').equal('test-user-1');
            msg.should.be.have.property('user').equal('anonymous');
            msg.should.be.have.property('body').equal('Test chat message!');
            msg.should.be.have.property('date');
        })
        
        .then(done, done);
    });

    it('should correctly create and distrupt edges', function(done) {

        function findEdges(user) {
            return db.collection('edges').find({$or: [{vertexA: user}, {vertexB: user}]}).toArray();
        }

        function checkEdges(edges, user, neighbors, isDisrupt) {
            var vertices = [];

            edges.forEach(function(edge) {
                if (isDisrupt) {
                    edge.should.have.property('disruptDate').Date();
                }
                else {
                    edge.should.have.property('disruptDate').null();
                }
                [edge.vertexA, edge.vertexB].should.containEql(user);
                if (edge.vertexA != user) vertices.push(edge.vertexA);
                if (edge.vertexB != user) vertices.push(edge.vertexB);
            });

            vertices.sort(function(a, b) {return a.localeCompare(b);});

            vertices.should.be.deepEqual(neighbors);
        }

        db.collection('users').insert([
            {_id: 'user1'},
            {_id: 'user2'},
            {_id: 'user3'},
            {_id: 'user4'},
            {_id: 'user5'},
            {_id: 'user6'}
        ])
        .then(function() {
            return storage.createEdge('user1', 'user3');
        })
        .then(function() {
            return storage.createEdge('user1', 'user5');
        })
        .then(function() {
            return storage.createEdge('user5', 'user6');
        })
        .then(function() {
            return storage.createEdge('user5', 'user1');
        })


        .then(function() {
            return findEdges('user1');
        })
        .then(function(edges) {
            checkEdges(edges, 'user1', ['user3', 'user5']);
        })


        .then(function() {
            return findEdges('user3');
        })
        .then(function(edges) {
            checkEdges(edges, 'user3', ['user1']);
        })

        .then(function() {
            return findEdges('user5');
        })
        .then(function(edges) {
            checkEdges(edges, 'user5', ['user1', 'user6']);
        })


        .then(function() {
            return storage.disruptEdge('user1', 'user3');
        })
        .then(function() {
            return storage.disruptEdge('user1', 'user5');
        })
        .then(function() {
            return storage.disruptEdge('user5', 'user6');
        })

        .then(function() {
            return findEdges('user1');
        })
        .then(function(edges) {
            checkEdges(edges, 'user1', ['user3', 'user5'], true);
        })


        .then(function() {
            return findEdges('user3');
        })
        .then(function(edges) {
            checkEdges(edges, 'user3', ['user1'], true);
        })

        .then(function() {
            return findEdges('user5');
        })
        .then(function(edges) {
            checkEdges(edges, 'user5', ['user1', 'user6'], true);
        })

        .then(done, done);
    });


    it('should clear old edges', function(done) {
        db.collection('edges').insertMany([
            {
                vertexA: 'user1',
                vertexB: 'user2',
                disruptDate: new Date(Date.now() - 20 * 60 * 1000)
            },
            {
                vertexA: 'user1',
                vertexB: 'user3',
                disruptDate: new Date(Date.now() - 10 * 60 * 1000)
            },
            {
                vertexA: 'user1',
                vertexB: 'user4'
            },
        ])
        
        .then(function() {
            return storage.clearOldEdges('user1');
        })
        
        .then(function() {
            return db.collection('edges').find({}).toArray();
        })
        
        .then(function(edges) {
            edges.should.be.lengthOf(2);
            edges[0].vertexB.should.be.equal('user3');
            edges[1].vertexB.should.be.equal('user4');
        })

        .then(done, done);
    });

    it('graphTraversal', function(done) {
        var now = new Date();

        // new Date(Date.now() - 1000 * 60 * 20)
        
        db.collection('users').insertMany([
            {_id: 'user1'},
            {_id: 'user2'},
            {_id: 'user3'},
            {_id: 'user4'},
            {_id: 'user5'},
            {_id: 'user6'},
            {_id: 'user7'},
            {_id: 'user8'},
            {_id: 'user9'},
            {_id: 'user10'},
            {_id: 'user11'}
        ])
        .then(function() {
            return Promise.all([
                storage.createEdge('user1', 'user3'),
                storage.createEdge('user1', 'user5')
            ]);
        })
        .then(function() {
            return Promise.all([
                storage.createEdge('user2', 'user6'),
                storage.createEdge('user2', 'user3')
            ]);
        })
        .then(function() {
            return Promise.all([
                storage.createEdge('user10', 'user8'),
                storage.createEdge('user10', 'user9'),
                storage.createEdge('user10', 'user11'),
            ]);

        })
        .then(function() {
            return db.collection('edges').updateOne({vertexA: 'user10', vertexB: 'user8'}, {
                $set: {
                    disruptDate: new Date(Date.now() - 1000 * 60 * 10)
                }
            });
        })
        .then(function() {
            return db.collection('edges').updateOne({vertexA: 'user10', vertexB: 'user11'}, {
                $set: {
                    disruptDate: new Date(Date.now() - 1000 * 60 * 20)
                }
            });
        })
        
        .then(function() {
            return storage.graphTraversal('user1');
        })
        .then(function(graph) {
            graph.vertices.sort().should.be.deepEqual(['user1', 'user2', 'user3', 'user5', 'user6']);
        })

        .then(function() {
            return storage.graphTraversal('user3');
        })
        .then(function(graph) {
            graph.vertices.sort().should.be.deepEqual(['user1', 'user2', 'user3', 'user5', 'user6']);
        })

        .then(function() {
            return storage.graphTraversal('user4');
        })
        .then(function(graph) {
            graph.vertices.sort().should.be.deepEqual(['user4']);
        })


        .then(function() {
            return storage.graphTraversal('user8');
        })
        .then(function(graph) {
            graph.vertices.sort().should.be.deepEqual(['user10', 'user8', 'user9']);
        })

        .then(done, done);
    });
});
