// server.js
// where your node app starts

// init project
const https = require('http');
const path = require('path');
const tls = require('https');
const fs = require('fs');
const scrape = require('./scrape.js');
const url = require('url');
const pug = require('pug');

console.log('scraping starting');
var scraper = new scrape();

var ipcache ={};

function throttle(ip) {
  var current = ipcache[ip],
    rate,
    diff,
   block = false;
  if (current === undefined) {
    current = {
      starttime : new Date().getTime(),
      count : 0
    };
  }
  current.count++;
  diff = new Date().getTime() - current.starttime;
  rate = diff / current.count;
  ipcache[ip] = current;
  //console.log(ip, current, diff, rate);
  return block;
}

function getIntOrDefault(value, min, defaultValue) {
  var int = parseInt(value,10);
  int = Number.isNaN(int) ? defaultValue : int;
  int = int < min ? defaultValue : int;
  return int;
}

function app(res, query) {
  var query = query || {},
      page = getIntOrDefault(query.page, 1, 1),
      userid= getIntOrDefault(query.userid);
  
  scraper.getList(page, userid, function (data) {
    data.page = page;
    data.userid = userid;
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.write(pug.renderFile('views/index.pug', data));
    res.end();
  });
}

function appAdmin(res, query) {
  var query = query || {},
      page = getIntOrDefault(query.page, 1, 1),
      userid= getIntOrDefault(query.userid);
  
  scraper.getAdminList(page, userid, function (data) {
    data.page = page;
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.write(pug.renderFile('views/indexAdmin.pug', data));
    res.end();
  });
}

function file(res, file, none) {
  var fp = path.normalize(file), 
      ext = path.extname(fp),
      ct = {
        '.css':'text/css',
        '.js':'text/javascript'
      }[ext] || 'text/plain';
  if (fp.indexOf('/public/') === 0) {
    fs.stat('.' + fp, (err, stat) => {
      if (err) {
        console.error(err);
        res.writeHead(404);
        res.end();
        return;
      }
      if (none == stat.atimeMs) {
         res.writeHead(304);
         res.end();
      } else {
        fs.readFile('.' + fp, (err, data) => {
          if (err) throw err;
          res.writeHead(200, 
            {
              'Content-Type': ct,
              'Cache-Control': 'public, max-age=30',
              'ETag': stat.atimeMs,
            });
          res.end(data);
        });
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
}

function rawFile(res, file) {
  res.writeHead(200);
    
   fs.readFile(file, (err, data) => {
    if (err) throw err;
    res.end(data);
  });
}

function icon(res, none) {
  var etag = '421041f8-4b67-4823-8f14-4306a24720b7',
      url = 'https://cdn.glitch.com/421041f8-4b67-4823-8f14-4306a24720b7/img_519506.png?1518898663925',
      request;
  if (none == etag) {
    res.writeHead(304);
    res.end();
  } else {
    res.writeHead(200, 
      {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
        'ETag': etag
      });
     request = tls.get(url, function(response) {
     response.pipe(res);
   });
   request.end();
  }
}

https.createServer( (req, res) => {
  var parsed = url.parse(req.url, true);
  var ip = req.headers['x-forwarded-for'].split(',')[0];
  if (throttle(ip)) {
    console.log('too many requests from ', ip);
  }
  if (parsed.pathname.indexOf('/public/') === 0){
    file(res, parsed.pathname, req.headers['if-none-match'] );
  } else  if (parsed.pathname === '/') {
    app(res, parsed.query);
  } else  if (parsed.pathname === '/admin') {
    appAdmin(res, parsed.query);  
  } else if (req.url === '/favicon.ico') {
    icon(res, req.headers['if-none-match']);
  } else if (req.url === '/feed.atom') {
     rawFile(res,'feed.atom');
  } else if (req.url === '/feed.rss') {
     rawFile(res,'feed.rss');  
  } else if (req.url === '/feed2.rss') {
     rawFile(res,'feedrss-2.rss');
  } else if (req.url.indexOf('/admin/refresh') === 0 && req.method === 'POST') {
     var body = '';
     console.log('read post bidy', req.url);
     function sendError(err, cnt) {
       res.writeHead(err);
       if (cnt) res.write(cnt);
       res.end();
     }
     req.on('data', function (data) {
          body += data;
          if (body.length > 25) { 
            sendError(413);
            body = undefined;
          }
      });
      req.on('end', function () {
        var params, userid, loc;
        if (body) {
          params = body.split('=');
          if (params.length != 2) {
            sendError(400, 'invalid length');
          } else {
            if (params[0] === 'userid' && (!Number.isNaN(userid = parseInt(params[1])))){
              console.log('parsed out', userid);
              scraper.refreshUser(userid);
            } else {
              sendError(400, 'invalid parameter');
            }
          }
        }
        console.log(parsed.query);
        loc = '/admin';
        if (parsed.query && parsed.query.page) {
          loc = loc + '?page=' + parsed.query.page;   
        }
        res.writeHead(303, {'Location': loc});
        res.end();
      });
  } else {
    res.writeHead(404);
    console.log(req.url);
    res.end();
  }
}).listen(3000);

function makeDate(ele, dt) {
  return '<' + ele + '>' + dt.toISOString() + '</' + ele + '>';
}

