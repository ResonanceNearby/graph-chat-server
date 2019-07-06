var io          = require('socket.io-client'),
    MongoClient = require('mongodb').MongoClient,
    should      = require('should');

var TIME_FACTOR = 1;

function makeTestUser() {
    var user = {
        log: []
    };

    user.connect = function(timeout) {
        function userConnect() {
            user.socket = io('http://localhost:10080', { 'force new connection': true });

            user.socket.on('connect_error', function(obj) {
                console.log('connect_error: ', obj);
            });

            var setEventHandler = function(event) {
                user.socket.on(event, function(data, fn) {
                    user.log.push([event, data]);
                    if (fn) { fn(); }
                });
            };

            setEventHandler('chatinfo');
            setEventHandler('messages');
        }

        if (!timeout) {
            userConnect();
        }
        else  {
            setTimeout(userConnect, timeout * TIME_FACTOR);
        }

        return user;
    };

    user.disconnect = function(timeout) {
        setTimeout(function() {
            user.socket.close();
            user.socket = undefined;
        }, timeout * TIME_FACTOR);

        return user;
    };


    user.send = function(timeout, event, data) {
        setTimeout(function() {
            user.socket.emit(event, data);
        }, timeout * TIME_FACTOR);
        return user;
    };

    user.filterLog = function(type) {
        return user.log.filter(function(r) {
            return r[0] == type;
        });
    };

    user.printLog = function() {
        user.log.forEach(function(r) {
            console.log(r[0], ': ', r[1]);
        });
    };

    return user;
}

describe('Chat', function() {
    this.timeout(1000 * 10);

    var server, storage;
    var mongoUrl = 'mongodb://localhost/test';

    before(function() {
        return require('../server/index.js')(10080, 'mongodb://localhost/test', {clientMaxTimeout: 1000 * 3 * TIME_FACTOR})
               .then(function(app) {
                   server = app.server;
                   storage = app.storage;
               });
    });

    beforeEach(function() {
        return storage.clearDb();
    });


    after(function() {
        server.close();
    });

    it('Простая ситуация с двумя пользователями и одним сообщением', function(done) {
        var user1 = makeTestUser()
                .connect()
                .send(50, 'greeting', {id: 'user1', nickname: 'User1'})
                .send(100, 'found', 'user2');

        var user2 = makeTestUser()
                .connect()
                .send(0, 'greeting', {id: 'user2', nickname: 'User2'})
                .send(200, 'found', 'user1')
                .send(300, 'chatmessage', 'Hello world');
    


        setTimeout(function() {
            user1.log.should.be.lengthOf(3);
            user1.log[0].should.be.deepEqual(['chatinfo', {size: 2, edgeCount: 1}]);
            user1.log[1].should.be.deepEqual(['chatinfo', {size: 2, edgeCount: 1}]);
            user1.log[2][0].should.be.equal('messages');
            user1.log[2][1][0].should.be.have.property('user').equal('User2');
            user1.log[2][1][0].should.be.have.property('body').equal('Hello world');
            
            done();
        }, 500 * TIME_FACTOR);
    });

    it('Проверка получения истории сообщений', function(done) {
        var user1 = makeTestUser()
                .connect()
                .send(100, 'greeting', {id: 'user1', nickname: 'User1'})
                .send(200, 'found', 'user2')
                .disconnect(300)
                .connect(500)
                .send(600, 'greeting', {id: 'user1', nickname: 'User1'});


        var user2 = makeTestUser()
                .connect()
                .send(0, 'greeting', {id: 'user2', nickname: 'User2'})
                .send(300, 'found', 'user1')
                .send(400, 'chatmessage', 'Hello world');

        setTimeout(function() {
            user1.log.should.be.lengthOf(2);
            user1.log[0].should.be.deepEqual(['chatinfo', {size: 2, edgeCount: 1}]);
            user1.log[1][0].should.be.equal('messages');
            user1.log[1][1][0].should.be.have.property('user').equal('User2');
            user1.log[1][1][0].should.be.have.property('body').equal('Hello world');

            
            done();
        }, 800 * TIME_FACTOR);
    });

    it('Проверка очистки истории после истечения максимального периода отсутствия', function(done) {
        var user1 = makeTestUser()
                .connect()
                .send(100, 'greeting', {id: 'user1', nickname: 'User1'})
                .send(200, 'found', 'user2')
                .disconnect(300)
                .connect(4000)
                .send(4500, 'greeting', {id: 'user1', nickname: 'User1'});


        var user2 = makeTestUser()
                .connect()
                .send(0, 'greeting', {id: 'user2', nickname: 'User2'})
                .send(300, 'found', 'user1')
                .send(400, 'chatmessage', 'Hello world');

        setTimeout(function() {
            user1.filterLog('messages').should.be.lengthOf(0);
            
            done();
        }, 8000 * TIME_FACTOR);
    });

    it('Проверка получения сообщения во всём графе', function(done) {
        var user1 = makeTestUser()
                .connect()
                .send(50, 'greeting', {id: 'user1', nickname: 'User1'})
                .send(100, 'found', 'user2')
                .send(150, 'found', 'user4');

        var user2 = makeTestUser()
                .connect()
                .send(50, 'greeting', {id: 'user2', nickname: 'User2'})
                .send(100, 'found', 'user1')
                .send(150, 'found', 'user3')
                .send(300, 'chatmessage', 'Hello world');

        var user3 = makeTestUser()
                .connect()
                .send(0, 'greeting', {id: 'user3', nickname: 'User3'})
                .send(100, 'found', 'user2')
                .send(150, 'found', 'user4');

        var user4 = makeTestUser()
                .connect()
                .send(0, 'greeting', {id: 'user4', nickname: 'User4'})
                .send(100, 'found', 'user3')
                .send(150, 'found', 'user1')
                .send(600, 'chatmessage', 'Another message');

        var user5 = makeTestUser()
                .connect()
                .send(0, 'greeting', {id: 'user5', nickname: 'User5'})
                .send(100, 'found', 'user6');


        setTimeout(function() {
            var log1 = user1.filterLog('messages');
            log1.should.be.lengthOf(2);
            log1[0][1][0].should.be.have.property('user').equal('User2');
            log1[0][1][0].should.be.have.property('body').equal('Hello world');
            log1[1][1][0].should.be.have.property('user').equal('User4');
            log1[1][1][0].should.be.have.property('body').equal('Another message');

            var log3 = user3.filterLog('messages');
            log3.should.be.lengthOf(2);
            log3[0][1][0].should.be.have.property('user').equal('User2');
            log3[0][1][0].should.be.have.property('body').equal('Hello world');
            log3[1][1][0].should.be.have.property('user').equal('User4');
            log3[1][1][0].should.be.have.property('body').equal('Another message');

            var log4 = user4.filterLog('messages');
            log4.should.be.lengthOf(1);
            log4[0][0].should.be.equal('messages');
            log4[0][1][0].should.be.have.property('user').equal('User2');
            log4[0][1][0].should.be.have.property('body').equal('Hello world');

            user5.filterLog('messages').should.be.lengthOf(0);
            
            done();
        }, 2000 * TIME_FACTOR);

    });

    it('Проверка в условиях изменяющегося графа', function(done) {
        var user1 = makeTestUser()
                .connect()
                .send(0, 'greeting', {id: 'user1', nickname: 'User1'})
                .send(100, 'found', 'user2')
                .send(100, 'found', 'user3')
                .send(400, 'lost', 'user3');
        
        var user2 = makeTestUser()
                .connect()
                .send(0, 'greeting', {id: 'user2', nickname: 'User2'})
                .send(200, 'found', 'user1')
                .send(200, 'found', 'user3')
                .send(300, 'chatmessage', 'Hello world')
                .send(450, 'lost', 'user3')
                .send(500, 'chatmessage', 'Another Hello world')
                .send(600, 'found', 'user3')
                .send(600, 'lost', 'user1')
                .send(6000, 'neighborhood', ['user1']);

        var user3 = makeTestUser()
                .connect()
                .send(0, 'greeting', {id: 'user3', nickname: 'User3'})
                .send(100, 'found', 'user2')
                .send(100, 'found', 'user1')
                .send(400, 'lost', 'user2')
                .send(400, 'lost', 'user1')
                .send(550, 'chatmessage', 'Third message')
                .send(5000, 'chatmessage', 'Fourth message');

        setTimeout(function() {
            var log1 = user1.filterLog('messages');
            log1.should.be.lengthOf(3);
            log1[0][1][0].should.be.have.property('user').equal('User2');
            log1[0][1][0].should.be.have.property('body').equal('Hello world');
            log1[1][1][0].should.be.have.property('user').equal('User2');
            log1[1][1][0].should.be.have.property('body').equal('Another Hello world');
            log1[2][1][0].should.be.have.property('user').equal('User3');
            log1[2][1][0].should.be.have.property('body').equal('Third message');


            var log2 = user2.filterLog('messages');
            log2.should.be.lengthOf(2);
            log2[0][1][0].should.be.have.property('user').equal('User3');
            log2[0][1][0].should.be.have.property('body').equal('Third message');
            log2[1][1][0].should.be.have.property('user').equal('User3');
            log2[1][1][0].should.be.have.property('body').equal('Fourth message');


            var log3 = user3.filterLog('messages');
            log3.should.be.lengthOf(2);
            log3[0][1][0].should.be.have.property('user').equal('User2');
            log3[0][1][0].should.be.have.property('body').equal('Hello world');
            log3[1][1][0].should.be.have.property('user').equal('User2');
            log3[1][1][0].should.be.have.property('body').equal('Another Hello world');

            done();
        }, 8000 * TIME_FACTOR);
    });

    it('Проверка правильного подсчёта колличества ребёр', function(done) {
        var user1 = makeTestUser().connect().send(0, 'greeting', {id: 'user1', nickname: 'User1'});
        var user2 = makeTestUser().connect().send(0, 'greeting', {id: 'user2', nickname: 'User2'});
        var user3 = makeTestUser().connect().send(0, 'greeting', {id: 'user3', nickname: 'User3'});
        var user4 = makeTestUser().connect().send(0, 'greeting', {id: 'user4', nickname: 'User4'});
        
        user2.send(150, 'found', 'user1'); // user1
        user3.send(250, 'found', 'user2'); // user2
        user1.send(400, 'found', 'user3'); // user3
        user1.send(400, 'found', 'user2'); // user2, user3
        user4.send(500, 'found', 'user3'); // user3
        user2.send(600, 'found', 'user3'); // user1, user3
        user3.send(650, 'found', 'user1'); // user1, user2
        user3.send(650, 'found', 'user4'); // user1, user2, user4
        user4.send(750, 'found', 'user2'); // user2, user3
        user4.send(850, 'found', 'user1'); // user1, user2, user3
        user1.send(900, 'found', 'user4'); // user2, user3, user4
        user2.send(950, 'found', 'user4'); // user1, user3, user4

        user1.send(1000, 'lost', 'user4'); // user2, user3
        user1.send(1050, 'lost', 'user3'); // user2
        user2.send(1100, 'lost', 'user3'); // user1, user4
        user2.send(1150, 'lost', 'user4'); // user1
        user2.send(4200, 'refreshchatinfo', null);
        user4.send(4200, 'refreshchatinfo', null);
        
        setTimeout(function() {
            var chatInfoLog = function(user) {
                return user.filterLog('chatinfo').map(function(r) { return r[1]; });
            };

            var log1 = chatInfoLog(user1),
                log2 = chatInfoLog(user2),
                log3 = chatInfoLog(user3),
                log4 = chatInfoLog(user4);


            log1[0].should.be.deepEqual({size: 2, edgeCount: 1});
            log2[0].should.be.deepEqual({size: 2, edgeCount: 1});
            
            log1[1].should.be.deepEqual({size: 3, edgeCount: 2});
            log2[1].should.be.deepEqual({size: 3, edgeCount: 2});
            log3[0].should.be.deepEqual({size: 3, edgeCount: 2});

            log1[2].should.be.deepEqual({size: 3, edgeCount: 3});
            log2[2].should.be.deepEqual({size: 3, edgeCount: 3});
            log3[1].should.be.deepEqual({size: 3, edgeCount: 3});

            log1[3].should.be.deepEqual({size: 3, edgeCount: 3});
            log2[3].should.be.deepEqual({size: 3, edgeCount: 3});
            log3[2].should.be.deepEqual({size: 3, edgeCount: 3});

            log1[4].should.be.deepEqual({size: 4, edgeCount: 4});
            log2[4].should.be.deepEqual({size: 4, edgeCount: 4});
            log3[3].should.be.deepEqual({size: 4, edgeCount: 4});
            log4[0].should.be.deepEqual({size: 4, edgeCount: 4});

            log1[5].should.be.deepEqual({size: 4, edgeCount: 4});
            log2[5].should.be.deepEqual({size: 4, edgeCount: 4});
            log3[4].should.be.deepEqual({size: 4, edgeCount: 4});
            log4[1].should.be.deepEqual({size: 4, edgeCount: 4});

            log1[6].should.be.deepEqual({size: 4, edgeCount: 4});
            log2[6].should.be.deepEqual({size: 4, edgeCount: 4});
            log3[5].should.be.deepEqual({size: 4, edgeCount: 4});
            log4[2].should.be.deepEqual({size: 4, edgeCount: 4});

            log1[7].should.be.deepEqual({size: 4, edgeCount: 4});
            log2[7].should.be.deepEqual({size: 4, edgeCount: 4});
            log3[6].should.be.deepEqual({size: 4, edgeCount: 4});
            log4[3].should.be.deepEqual({size: 4, edgeCount: 4});

            log1[8].should.be.deepEqual({size: 4, edgeCount: 5});
            log2[8].should.be.deepEqual({size: 4, edgeCount: 5});
            log3[7].should.be.deepEqual({size: 4, edgeCount: 5});
            log4[4].should.be.deepEqual({size: 4, edgeCount: 5});

            log1[9].should.be.deepEqual({size: 4, edgeCount: 6});
            log2[9].should.be.deepEqual({size: 4, edgeCount: 6});
            log3[8].should.be.deepEqual({size: 4, edgeCount: 6});
            log4[5].should.be.deepEqual({size: 4, edgeCount: 6});

            log1[10].should.be.deepEqual({size: 4, edgeCount: 6});
            log2[10].should.be.deepEqual({size: 4, edgeCount: 6});
            log3[9].should.be.deepEqual({size: 4, edgeCount: 6});
            log4[6].should.be.deepEqual({size: 4, edgeCount: 6});

            log1[11].should.be.deepEqual({size: 4, edgeCount: 6});
            log2[11].should.be.deepEqual({size: 4, edgeCount: 6});
            log3[10].should.be.deepEqual({size: 4, edgeCount: 6});
            log4[7].should.be.deepEqual({size: 4, edgeCount: 6});


            log1[12].should.be.deepEqual({size: 2, edgeCount: 1});
            log2[12].should.be.deepEqual({size: 2, edgeCount: 1});
            log3[11].should.be.deepEqual({size: 2, edgeCount: 1});
            log4[8].should.be.deepEqual({size: 2, edgeCount: 1});
            
            done();
        }, 4500 * TIME_FACTOR);
    });
});
