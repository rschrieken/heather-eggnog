const WebSocketClient = require('websocket').client;
const Datastore = require('nedb');  
const webclient = require('https');
const htmlparser = require('htmlparser2');
const zlib = require("zlib");
const StringDecoder = require('string_decoder').StringDecoder;


var db = new Datastore({ filename: '.data/close-voters.nedb' });
var stats = { };

db.ensureIndex({ fieldName: 'total', unique:false }, function(err) {
  if (err) console.error(err);
});

db.ensureIndex({ fieldName: 'lastupdate', unique:false }, function(err) {
  if (err) console.error(err);
});

db.ensureIndex({ fieldName: 'userid', unique:true }, function(err) {
  if (err) console.error(err);
});

function User () {
}


db.persistence.compactDatafile();

function dbc(cb) {
  if (cb === undefined) throw new Error('no cb defined');
  return function(err, doc) {
    if (err) throw err;
    cb(doc);
  }
}

function findUserRank(id, callback) {
  if (Number.isNaN(id)) callback();
  db.findOne({userid: id}, dbc(function(user) {
    if (user) {
      db.count({ total: { $gt: user.total - 1 } }, dbc(function (cnt) {    
        user.rank = cnt;
        callback(user);
      }));
    } else {
      callback();
    }
  }));
}

function getAdminList(page, userid, callback) {
  page = page || 1;
  getCounts( function(totalCount, pendingCount) {
    db.find({}).
      sort({ lastupdate: -1 }).
      skip((page - 1) * 50).
      limit(50).
      exec(dbc(function (docs) {
        var viewModel = { 
          totalCount: totalCount, 
          users: docs
        };
        callback(viewModel);
      }));
  });
}


function getList(page, userid, callback) {
  page = page || 1;
  getCounts( function(totalCount, pendingCount) {
    db.
      find({}).
      sort({ total: -1, lastupdate: 1 }).
      skip((page - 1) * 50).
      limit(50).
      exec(dbc(function (docs) {
        var viewModel = { 
          totalCount: totalCount, 
          pendingCount: pendingCount,
          users: docs
        };

        findUserRank(userid, function(user) {
          viewModel.user = user;
          callback(viewModel);
        });

      }));
  });
}

function getCounts(callback) {
  db.count({}, dbc(function (fullcnt) {
    //{ $lt: 9344669 }
    db.count({ lastupdate: { $lt: 9344669 } }, dbc(function (cnt) {
      callback(fullcnt, cnt);
    }));
  }));
}

function ReviewDashboardUpdate(db) {
   var pollUsers = [], cachedUsers = {}, poller, currentPoll, pollTime = 10000, pollBackoff = 120000;
  
  function processBacklog() {
    db.find({ lastupdate: { $lt: 9344669 } }).sort({ lastupdate: 1 }).limit(6).exec(function (err, docs) {
      if (err) {console.error(err); return;}
      if (docs && docs.length > 0 ) {
        //console.log(docs);
        docs.forEach((i) => {pollUsers.push(i);});
      }
    });
  }

  
  function procesUser(user) {
    console.log('pu', user, cachedUsers);
    var last = new Date(user.lastupdate || 1).getTime();
    var now = new Date().getTime();
    var diff = now - last;
    if (diff > 60*60*24*1000) {
      pollUsers.push(user);
    } 
  }
  
  function processUserForCache(userid) {
     var user = {userid: userid};
     cachedUsers[user.userid] = (cachedUsers[user.userid] || 0) + 1;
     if (cachedUsers[user.userid] === 1) {
       console.log('find one ', user);
       db.findOne(user, function(err,doc){
         if (err) {
           console.error(err);
           return;
         }
         procesUser(doc || user);   
       });
     } else if (cachedUsers[user.userid] > 39) {
        console.log('reached 39', user);
        pollUsers.push(user);
        delete cachedUsers[user.userid];   
       }
  }
  
  function message(msg) {
     var reviewUser = JSON.parse(msg), user;
     if (reviewUser.i === 2) {  
       processUserForCache(reviewUser.u);
     }
  }
  /*
  <div class="um-header">
    <div class="um-gravatar"><a href="/users/915467/yvesleborg"><div class="gravatar-wrapper-64"><img src="https://i.stack.imgur.com/FBplw.jpg?s=64&amp;g=1" alt="" width="64" height="64"></div></a></div>
    <div class="um-header-info">
        <a href="/users/915467/yvesleborg" class="um-user-link">YvesLeBorg</a><br />
        <div class="um-flair"><span class="reputation-score" title="reputation score " dir="ltr">7,942</span><span title="5 gold badges"><span class="badge1"></span><span class="badgecount">5</span></span><span title="23 silver badges"><span class="badge2"></span><span class="badgecount">23</span></span><span title="40 bronze badges"><span class="badge3"></span><span class="badgecount">40</span></span></div>
        active 14 secs ago<br />
        today 36, week 120, month 195, total 582
    </div>
</div>
  */
  function ParserUserInfoResult() {
    var states = {
        'img' : 1,
        'div' : 2,
        'a' : 4,
        'flair': 8
      },
      state = 0,  
        alt ='',
      parser = new htmlparser.Parser({
        onopentag: function(name, attributes) {
          if (name === 'a') {
            state = state | states.a;
            //result.user_link = attributes["href"];
          }
          if (name === 'img') {
            state = state | states.img;
            result.user_img = attributes["src"];
          }
          if (name === 'div' && attributes["class"] === 'um-header-info') {
            state = state | states.div;
          }
          if (name === 'div' && attributes["class"] === 'um-flair') {
            state = state | states.flair;
          }
          //console.log('open ', name, state);
        },
        onclosetag: function(name) {
          if (name === 'div' || name === 'a' || name === 'img') {
            if (name === 'div' && ((state & states.flair) === states.flair)) {
              name = 'flair';
            }
            var reset = states[name];
            if ((state & reset) === reset) {
              state = (state ^ reset);
            }
          }
          //console.log('close ', name, state);
        },
        ontext: function(txt) {
          var trimmed = txt.trim();
          if (trimmed.length > 0) {
            if ((state & states.a) === states.a) {
                alt += trimmed;
              result.username = alt;
            }
            if (((state & states.a) !== states.a) &&
               ((state & states.div) === states.div)) {
               result.stats = trimmed;
            }
            //console.log('text ', trimmed, state, result, alt);
          }
        }
      }, { 
        decodeEntities: true 
      }),
      result = {};
    
    function _write(data) {
      parser.write(data);
    }
    function _end() {
      var statRes, singleRes, i;
      statRes = result.stats.split(', ');
      for(i = 0; i < statRes.length; i = i +1) {
        singleRes = statRes[i].split(' ');
        result[singleRes[0]] = parseInt(singleRes[1],10);
      }
      delete(result.stats);
      parser.end();
    }
    
    return {
      write: _write,
      end: _end,
      result: result
    }
  }
  
  function processUserInfoResult(res, userid, callback) {
    var result, parser;
    
    parser = new ParserUserInfoResult();
    
    if (res.statusCode !== 200) {
      console.error(res.statusCode, res.headers); 
      if (res.statusCode === 302) {
        callback({ userid: userid}, true);
      } else {
        reschedulePoller(true);
      }
      return;
    }
    
    if (res.headers['content-encoding'] === 'gzip') 
    {
      var gunzip = zlib.createGunzip();            
      res.pipe(gunzip);
      result = gunzip;
    } else {
      res.setEncoding('utf8');
      result = res;
    }
    result.on('data', function(data) {
          parser.write(data);
      }).on("end", function() {
          var result;
          parser.end();
          result = parser.result;
          result.userid = userid;
      
          if (result.total && result.total === 0)
          {
            console.log('zero user ', result);
            callback(result, true);
          } else {
            callback(result); 
          }
      });
  }
  
  function fetchReviewUserInfo(userid, callback) {
    var options = {
        hostname: 'stackoverflow.com',
        port: 443,
        path: '/review/user-info/2/' + userid,
        method: 'GET',
        headers : {
          'user-agent': 'Mozilla/5.0 (NodeJS; Glitch; Docker;)  heather-eggnog https://stackoverflow.com/users/578411/rene',
          'accept': 'text/html, */*; q=0.01',
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': 'en-US,en;q=0.9,nl;q=0.8',
          'referer': 'https://stackoverflow.com/',
          'cache-control': 'no-cache',
          'x-requested-with' : 'XMLHttpRequest',
        }

      };
      const req = webclient.request(options, function (res) { processUserInfoResult(res, userid, callback); });
      req.on('error', (e) => {
        console.error(e);
        reschedulePoller(true);
        
      });
      req.end();
  }
  
  function reschedulePoller(error) {
    console.log('reschedule');
    if (error === true && currentPoll === pollBackoff) { 
      clearInterval(poller);
      console.error('poller stopped due to errors after backoff');
    } else {
      if (error === true) {
        startPoller(pollBackoff);
      } else {
        startPoller(pollTime);
      }
    }
  }
  
  function receivedUserinfo(user, remove){
    //console.log(user);
    if (remove === true) {
      console.log('error recvd ', user);
      /*
      // for now no more unattended deletes
      db.remove({ userid: user.userid}, {}, function(err,cnt) {
         if (err) {
            console.error(err);
            return;
          }
          console.log('user ', user, ' removed on request ', cnt);
      });
      */
    } else {
      user.lastupdate = new Date().getTime();
      db.update( 
        { userid: user.userid}, 
        user, 
        { upsert: true}, 
        function (err, numAffected, affectedDocuments, upsert) {
          if (err) {
            console.error(err);
            return;
          }
          console.info(' affected ' + numAffected + ' upsert ' + upsert + ' doc ', affectedDocuments);
       });
    }
  };
  
  function startPoller(time) {
    clearInterval(poller);
    currentPoll = time;
    poller = setInterval(function(){
      var user = pollUsers.shift();

      if (user !== undefined) {
        console.log(user);
        fetchReviewUserInfo(user.userid, receivedUserinfo);     
      } else {
        processBacklog();
      }
    }, time); // 10 seconds
  }
  
  startPoller(pollTime); // 10 seconds
  function DaySchedule() {
    var dayschedule;
    
    function schedule() {
      var endofDay = new Date(Date.now());
      endofDay.setHours(23);
      endofDay.setMinutes(59);
      endofDay.setSeconds(59);
      endofDay.setMilliseconds(500);
      var diff = endofDay.getTime() - Date.now();
      dayschedule = setTimeout(()=>{
        var id;
        console.log('end of day shedule', new Date());
        clearTimeout(dayschedule);
        for(var p in cachedUsers) {
          if (cachedUsers.hasOwnProperty(p)) {
            id = parseInt(p, 10);
            if (!Number.isNaN(id)) {
              console.log('csch key ', id, typeof id);
              if (cachedUsers[id] > 1) {
                console.log('poll end of day', cachedUsers[id]);
                pollUsers.push({userid: id});
              } 
              delete cachedUsers[id];     
            } else {
              console.warn('non-numeric key in cache' ,p );
            }
          }
        }
        setTimeout(schedule, 1000 * 10); // 10 seconds before reschedule
      }
      , diff);
    }
    
    schedule();
  }
  
  new DaySchedule();
  
  //pollUsers.push({userid: 447156})
  //fetchReviewUserInfo(447156, function (dd) {console.log(dd)});
  
  return { 
    message: message,
    processUser: processUserForCache
  }
}

/* current:
{"user_link":"/users/3890632/khelwood","user_img":"https://i.stack.imgur.com/hNkgF.png?s=64&g=1","username":"khelwood","stats":"today 1, week 1, month 17
, total 305","today":1,"week":1,"month":17,"total":305,"userid":3890632,"lastupdate":1518796082350,"_id":"0CtBUhomtejLCbd8"}

target:
{ 
"a":"/users/3890632/khelwood",
"b":"https://i.stack.imgur.com/hNkgF.png?s=64&g=1",
"n":"khelwood",
"t":305,
"i":3890632,
"u":1518796082350,
"_id":"0CtBUhomtejLCbd8"
}
*/

function migrate(db) {
/*
  db.update({}, {$unset: { stats:true, user_link:true, today:true, week:true, month:true }} , {multi:true}, function(err, aff) {
    if (err) {console.error(err);return;}
    console.info('migrated ', aff);
  });
  */
  /*
  db.find({userid: 2670892}, function(err,docs)  {
    if (err) {  console.error(err); return;}
    for(var i = 1; i< docs.length; i++) {
      db.remove({_id: docs[i]._id}, function(err,num) {
        if (err) {  console.error(err); return;}
        console.info(docs[i], ' removed ', num);
      });
    }
  });*/
  // remove duplicates
  /*
  var prev = -1;
  db.find({}).sort({ userid: 1 }).exec(function (err, docs) {
    var u;
        console.log('start remove dupes');
    for(var i = 0; i < docs.length; i++) {
      u = docs[i];
      if (prev === u.userid) {
        console.log(u);
        //db.remove({_id: u._id});
      } else {
        prev = u.userid || -1;
      }
    }
    console.log('end remove dupes');
  });  /*/
  //db.insert({userid:1, lastupdate:1}, function(err){console.log(err);});
  //  db.remove({_id: '03nqjni4itdWYkld'});
  
  /*
  db.find({}).exec(function (err, docs) {
    var u, cnt = 0;
    console.log('fixing userid');
    
    function updateOrRemove(key, userid) {
      db.update({ _id : key}, { $set: { userid: userid }},{}, function(err,aant) {
        if (err) {
          console.error(err);
          db.remove({ _id : key}, {}, function (err, rem) {
            if(err) { 
              console.error(err);
            } else {
              console.log('removed ',key, rem);
            }
          });
        } else {
          console.log('updated ', key);
        }
      });

    }
    for(var i = 0; i < docs.length; i++) {
      u = docs[i];
      if (typeof u.userid === 'string') {
        cnt++;
        console.log(u);
        updateOrRemove(u._id, parseInt(u.userid, 10));
      }
    }
    console.log('userid\'s to be fixed ' , cnt);
  });
  */
}
// use this function to load new id's
function load() {
  var fs = require('fs');
  fs.readFile('./cv-badge-3000.txt', 'utf8',(err, data) => {
    if (err) throw err;
    var ids = data.split(',');
    console.log(ids.length);
    ids.forEach( i => {
      var num  = parseInt(i,10);
      if (!Number.isNaN(num)) {
        db.insert({userid: num, lastupdate: num}, function(err,doc) {
          if (err) {console.error(err); throw err;}
          console.log(doc);
        });
      } else {
        console.warn('not a number ',i);
      }
    });
  });
}

function removeTotalZero() {
  return;  // let's not by accident remove stuff
  db.remove({total: 0} ,{ multi: false } , function (err,docs) {
    if (err) console.log(err);
    console.log(docs);
  });
}


//reviewDashboardUpdate.message(data.data);
function StackExchangeWebSocket(messageCallback, retries) {
  
  var client = new WebSocketClient(), retryCount = retries || 0;
  
  function StackExchangeConnectionHandler(connection)
  {
    connection.on('message', function(message) {
      if (retryCount > 0)  {retryCount--;}
      if (message.type === 'utf8') {
         //console.log("Received: '" + message.utf8Data + "'");
         var data = JSON.parse(message.utf8Data);
         //.console.log(data);
        if (data.action === '1-review-dashboard-update') {
           if (messageCallback) messageCallback(data.data);
        }
        if (data.action === 'hb') {
          connection.sendUTF(data.data);
        }
      }
    });

    connection.on('error', function(error) {
        retryCount++;
        console.log("Connection Error: " + error.toString());
    });
    connection.on('close', function() {
        if (retryCount > 3) { console.error('socket closed, max retries exceeded'); return; };
        console.log('Connection Closed/ retry ', retryCount);
        setTimeout(()=>{StackExchangeWebSocket(messageCallback, retryCount);  }, retryCount * 5);
    });

    connection.sendUTF('1-review-dashboard-update');
  }

  
  client.on('connectFailed', function(error) {
      console.log('Connect Error: ' + error.toString());
  });

  client.on('connect', StackExchangeConnectionHandler);

  client.connect('wss://qa.sockets.stackexchange.com/');
}

function Scrape() {
  
  var refreshUser;
  
  db.loadDatabase(function(err) {  
     
    if (err) {
      console.error(err);
      return;
    }
    var reviewDashboardUpdate = new ReviewDashboardUpdate(db);
    StackExchangeWebSocket(reviewDashboardUpdate.message);
    refreshUser = reviewDashboardUpdate.processUser;
  });
  
  return {
    getList: getList,
    getAdminList: getAdminList,
    refreshUser: function(userid) { if (refreshUser) refreshUser(userid)}
  }
}

module.exports = Scrape;