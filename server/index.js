function main(port, mongoUrl, opts) {
    var app  = require('express')();
    
    return require('./storage.js')(mongoUrl, opts).then(function(storage) {
        return new Promise(function(resolve) {
            var server = app.listen(port, function() {
                resolve({
                    server: server,
                    storage: storage
                });
            });

            require('./server.js')(server, storage);
        });
    });
}

if (require.main === module) {
    var config = require('config');
    
    main(config.get('port'), config.get('dbUrl'), {clientMaxTimeout: 1000 * 60 * config.get('clientMaxTimeout')}).then(function(app) {
        var host = app.server.address().address;
        var port = app.server.address().port;
        
        console.log('Resonance-Chat listening at http://%s:%s', host, port);
    });
}
else {
    module.exports = main;
}
