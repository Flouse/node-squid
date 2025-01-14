
/**
 * Module dependencies.
 */

var fs = require('fs');
var net = require('net');
var path = require('path');
var http = require('http');
var https = require('https');
var assert = require('assert');
var setup = require('../');


describe('proxy', function () {

  var proxy;
  var proxyPort;

  var server;
  var serverPort;

  before(function (done) {
    // setup proxy server
    proxy = setup(http.createServer());
    proxy.listen(function () {
      proxyPort = proxy.address().port;
      done();
    });
  });

  before(function (done) {
    // setup target server
    server = http.createServer();
    server.listen(function () {
      serverPort = server.address().port;
      done();
    });
  });

  after(function (done) {
    proxy.once('close', function () { done(); });
    proxy.close();
  });

  after(function (done) {
    server.once('close', function () { done(); });
    server.close();
  });

  it('should proxy HTTP GET requests', function (done) {
    var gotData = false;
    var gotRequest = false;
    var host = '127.0.0.1:' + serverPort;
    server.once('request', function (req, res) {
      gotRequest = true;
      // ensure headers are being proxied
      assert(req.headers['user-agent'] == 'curl/7.30.0');
      assert(req.headers.host == host);
      assert(req.headers.accept == '*/*');
      res.end();
    });

    var socket = net.connect({ port: proxyPort });
    socket.once('close', function () {
      assert(gotData);
      assert(gotRequest);
      done();
    });
    socket.once('connect', function () {
      socket.write(
        'GET http://' + host + '/ HTTP/1.1\r\n' +
        'User-Agent: curl/7.30.0\r\n' +
        'Host: ' + host + '\r\n' +
        'Accept: */*\r\n' +
        'Proxy-Connection: Keep-Alive\r\n' +
        '\r\n');
    });
    socket.setEncoding('utf8');
    socket.once('data', function (data) {
      assert(0 == data.indexOf('HTTP/1.1 200 OK\r\n'));
      gotData = true;
      socket.destroy();
    });
  });

  it('should establish connection for CONNECT requests', function (done) {
    var gotData = false;
    var socket = net.connect({ port: proxyPort });
    socket.once('close', function () {
      assert(gotData);
      done();
    });
    socket.once('connect', function () {
      var host = '127.0.0.1:' + serverPort;
      socket.write(
        'CONNECT ' + host + ' HTTP/1.1\r\n' +
        'Host: ' + host + '\r\n' +
        'User-Agent: curl/7.30.0\r\n' +
        'Proxy-Connection: Keep-Alive\r\n' +
        '\r\n');
    });
    socket.setEncoding('utf8');
    socket.once('data', function (data) {
      assert(0 == data.indexOf('HTTP/1.1 200 Connection established\r\n'));
      gotData = true;
      socket.destroy();
    });
  });

  it('should resume the client socket when it is unpiped', function (done) {
    server.once('request', function (req, res) {
      res.end();
    });

    var gotData = false;
    var host = '127.0.0.1:' + serverPort;
    var socket = net.connect({ port: proxyPort });

    socket.on('connect', function () {
      socket.write(
        'CONNECT ' + host + ' HTTP/1.1\r\n' +
        'Host: ' + host + '\r\n' +
        '\r\n'
      );
    });

    socket.on('close', function () {
      assert(gotData);
      done();
    });

    socket.setEncoding('utf8');
    socket.once('data', function (data) {
      assert(0 == data.indexOf('HTTP/1.1 200 Connection established\r\n'));

      socket.write(
        'POST / HTTP/1.1\r\n' +
        'Host: ' + host + '\r\n' +
        'Connection: close\r\n' +
        'Transfer-Encoding: chunked\r\n' +
        '\r\n'
      );

      socket.once('data', function (data) {
        assert(0 == data.indexOf('HTTP/1.1 200 OK\r\n'));
        gotData = true;
        socket.write('10\r\n{ "foo": "bar",\r\n');
      });
    });
  });


  describe('authentication', function () {
    function clearAuth () {
      delete proxy.authenticate;
    }

    before(clearAuth);
    after(clearAuth);

    it('should invoke the `server.authenticate()` function when set', function (done) {
      var auth = 'Basic Zm9vOmJhcg==';
      var called = false;
      proxy.authenticate = function (req, fn) {
        assert(auth == req.headers['proxy-authorization']);
        socket.destroy();
        called = true;
      };
      var socket = net.connect({ port: proxyPort });
      socket.once('close', function () {
        assert(called);
        done();
      });
      socket.once('connect', function () {
        socket.write(
          'GET / HTTP/1.1\r\n' +
          'Proxy-Authorization: ' + auth + '\r\n' +
          '\r\n');
      });
    });

    it('should provide the HTTP client with a 407 response status code', function (done) {
      proxy.authenticate = function (req, fn) {
        // reject everything
        fn(null, false);
      };
      var gotData = false;
      var socket = net.connect({ port: proxyPort });
      socket.once('close', function () {
        assert(gotData);
        done();
      });
      socket.once('connect', function () {
        socket.write('GET / HTTP/1.1\r\n\r\n');
      });
      socket.setEncoding('utf8');
      socket.once('data', function (data) {
        assert(0 == data.indexOf('HTTP/1.1 407'));
        gotData = true;
        socket.destroy();
      });
    });

    it('should close the socket after a CONNECT request\'s 407 response status code', function (done) {
      proxy.authenticate = function (req, fn) {
        // reject everything
        fn(null, false);
      };
      var gotData = false;
      var socket = net.connect({ port: proxyPort });
      socket.once('close', function () {
        assert(gotData);
        done();
      });
      socket.once('connect', function () {
        socket.write('CONNECT 127.0.0.1:80 HTTP/1.1\r\n\r\n');
      });
      socket.setEncoding('utf8');
      socket.once('data', function (data) {
        assert(0 == data.indexOf('HTTP/1.1 407'));
        gotData = true;
      });
    });

  });

});
