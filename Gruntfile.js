module.exports = function(grunt) {
    grunt.loadNpmTasks('grunt-express-server');
    grunt.loadNpmTasks('grunt-contrib-watch');

    grunt.initConfig({
        express: {
            options: {
                port: 9009
            },
            server: {
                options: {
                    script: 'server/index.js'
                }
            }
        },
        watch: {
            server: {
                files:  [ 'server/**/*.js' ],
                tasks:  [ 'express:server' ],
                options: {
                    spawn: false // for grunt-contrib-watch v0.5.0+, "nospawn: true" for lower versions. Without this option specified express won't be reloaded 
                }
            }
        }
    });

    grunt.registerTask('default', ['express:server', 'watch']);    
};
