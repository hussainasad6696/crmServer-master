const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const https = require('https');
const fs = require('fs');
const Alarm = require('./models/info');
const Login = require('./models/login');
const Histry = require('./models/history')
const fetch = require('node-fetch');
const schedule = require('node-schedule');
const path = require('path');
const querystring = require('querystring');
const multiparty = require('multiparty');
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");


const PORT = process.env.PORT || 50000;
const app = express();

// const sslServer = https.createServer({
//     key: fs.readFileSync('./sslCert/key.pem'),
//     cert: fs.readFileSync('./sslCert/cert.pem')
// }, app);


mongoose.connect('mongodb://localhost/CRMReminder', 
{useNewUrlParser:true, useUnifiedTopology: true, useCreateIndex: true},
err=> {
    if (!err){
        console.log('Connected to database...');
    }
    else{
        console.log('Error connecting to database '+ err);
    }
});
mongoose.Promise = global.Promise;
mongoose.set('useFindAndModify', false);

admin.initializeApp({                                       // Initialize app for job scheduling
    credential: admin.credential.cert(serviceAccount)
});

app.use(express.urlencoded({extended: true}));
app.use(express.static(path.join(__dirname,'views')));
app.use(express.json());
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
  });

app.use("/static/", express.static(__dirname+"/static"));
app.set('view engine',"ejs");
app.listen(PORT, ()=>{
    console.log(`Server running at port ${PORT}`);
});

app.get('/alarms', (req, res)=>{
    Alarm.find({deviceUserName:req.query.deviceUserName}).then((alarms, err)=>{
        if(err) {console.log(err)};
        res.send(alarms);
      })
})

app.get('/history', (req, res)=>{
    Histry.find({deviceUserName:req.query.deviceUserName}).then((alarms, err)=>{
        if(err) {console.log(err)};
        res.send(alarms);
      })
});

app.post('/deviceToken', (req, res)=>{
    Login.findOneAndUpdate({userName: req.body.id},
         {$addToSet: {deviceTokens: JSON.stringify(req.body.deviceToken)}},  
         {safe: true, upsert: true, new: true}, (err, result)=>{
             if (err){
                 console.log(err+" error on device token");
             }
             console.log(result+" device token not found :"+req.body.deviceToken);
         }).then((result)=>{
            console.log('Token received.'+result.deviceToken);
            res.sendStatus(200);
         })
});

// app.get('/', (req, res)=>{
//     console.log('Reminder is here')
//     res.render('index');
// })

app.post('/alarms', (req, res)=>{
    console.log(req.body);
    Alarm.create(req.body.alarmModelValues).then((alarm)=>{
        Alarm.findByIdAndUpdate({_id: alarm._id}, {deviceUserName: req.body.deviceUserName});
        Login.findOneAndUpdate({userName: req.body.deviceUserName}, 
            {$addToSet: {alarmIDs: JSON.stringify(alarm._id)}}, (err,res)=>{
            if(err){
                console.log(err+".............................error is here");
            }
        }).then((login)=>{
            var result = [];
            console.log("inside the login of alarms..........................................")
            result = help(alarm.time, alarm.date);
            min = result[0];
            hrs = result[1];
            date = result[2];
            month = result[3];
            const job = schedule.scheduleJob(`${min || '00'} ${hrs || '00'} ${date || '00'} ${month || '00'} *`, ()=>{
                console.log("inside the job schedular or alarm....................................")
                var registrationToken = login.deviceTokens;
                query = Alarm.findById(alarm._id);          // check if alarm exists in database
                    if(query)
                    {
                        registrationToken.forEach(element=> {
                            element = element.slice(1);
                            element = element.slice(0, -1);
                            console.log(element);
                            var message = {
                                notification: {
                                    title: alarm.alarmName,
                                    body: 'Comment: '+alarm.comment 
                                },
                                token: element
                            };
                            console.log("passed message json setter ........................................"+message);
                            admin.messaging().send(message)
                            .then((res)=>{
                                console.log('Notification sent: ', res);
                                console.log(alarm);
                                Histry.create(req.body.alarmModelValues).then(()=>{
                                    res.status(200).send('Added to history.');
                                });
                                Alarm.findByIdAndDelete({_id: alarm._id}, req.body).then((his)=>{
                                    console.log("Alarm deleted from current database."+his)
                                })
                            })
                            .catch((err)=>{
                                console.log('Error in sending notification:----------------- ', err);
                            });
                        });
                    }
                    else
                    {
                        console.log('Deleted alarm did not send notification.');
                    }
            });
            });
            });
        });

app.post('/delete/current', (req, res)=>{
    Login.updateOne( {deviceUserName: req.body.deviceUserName},
        { $pullAll: {alarmIDs: req.body.id } } );
    Alarm.findByIdAndDelete({_id: req.body.id}, req.body).then((alarm)=>{
        res.status(200).send('Alarm deleted'+alarm);
    });
    console.log('Deleted alarm from database.');
})

app.post('/delete/history', (req, res)=>{
    Histry.findByIdAndDelete({_id: req.body.id}, req.body).then((alarm)=>{
        res.status(200).send('Alarm deleted'+alarm);
    });
    console.log('Deleted alarm from database.');
})

app.post('/authentication', (req, res)=>{
    console.log("here =============================--------");
    const query = Login.where({userName: req.body.userName});
    query.findOne((err, login)=>{
        if (err){
            console.log(err);
            res.sendStatus(400);
        }
        if (login){
            if (login.password === req.body.password){
                console.log('Authentication successful.');
                res.sendStatus(200);
                console.log(login.id+ " login id");
                Login.findByIdAndUpdate({_id: mongoose.Types.ObjectId(login.id)}, {$inc: {numLogins: 1}})
                .then(()=>{
                    console.log('Number of logins increased.');
                })
            }
            else{
                console.log('Incorrect password');
                res.sendStatus(400);
            }
        }
        else{
            console.log('Username not returned.');
            res.sendStatus(404);
         }
        });
});

app.post('/logout', (req, res)=>{
    Login.findOneAndUpdate({userName: req.body.userId}, {$inc: {numLogins: -1}})
    .then((model, err)=>{
        if (err) {console.log(err)};
        console.log('Logged out.');
    })
});

app.get('/addUser', (req, res)=>{
    console.log("add User");
    res.render('addUser');
});

app.post('/addUser', (req,res)=>{
    console.log(req.body);
    let form = new multiparty.Form();
    const query = Login.where({userName: req.body.userName});
    query.findOne((err, login)=>{
        if (err){
            console.log(err);
            res.sendStatus(400);
        }
        if (login){
            console.log('Username exists.');
            res.sendStatus(403);
        }
        else{
            if (req.body.userName!="" && req.body.password!="" && req.body.maxLogins!="")
            {
                Login.create(req.body).then((login)=>{
                    Login.findOneAndUpdate({userName: login.userName}, 
                        {numLogins: 0}, (err,res)=>{
                        if(err){
                            console.log(err);
                        }
                    })
                    res.status(200).send('User added to database.');
                 });
            }
            else{
                res.send('All fields are required.');
            }
         }
        }
    );
});

app.post('/test', (req, res)=>{
    console.log('request received.');
    var result = [];
    result = help(req.body.time, req.body.date);
    min = result[0];
    hrs = result[1];
    date = result[2];
    month = result[3];
    console.log(hrs + " " + min + " " + date + " " + month);
    const job = schedule.scheduleJob(`${min || '00'} ${hrs || '00'} ${date || '00'} ${month || '00'} *`, ()=>{
        console.log(req.body);
    });
})

function help(t, d){
    var res = [];
    var time = JSON.stringify(t);
    var date = JSON.stringify(d);
    timesegs = time.split(':');
    timesegs2 = timesegs[1].split(' ');
    datesegs = date.split('-');
    res[1] = parseInt(timesegs[0].substring(1));
    res[0] = parseInt(timesegs2[0]);
    var temp = timesegs2[1].slice(0, -1);
    if (temp=='PM'){
        res[1] = (res[1]+12)%24;
        console.log(res[1]);
    }
    else{
        var hr = parseInt(timesegs[0])+12;
    }
    res[2] = parseInt(datesegs[2].slice(0, -1));
    res[3] = parseInt(datesegs[1]);
    return res;
}

app.get('alarm/urgent', (req, res) => {
    Alarm.find({backGroundColor: 'Urgent'}).then((alarms, err)=>{
        if(err) {console.log(err)};
        res.send(alarms);
      })
});

app.get('alarm/normal', (req, res) => {
    Alarm.find({backGroundColor: 'Normal'}).then((alarms, err)=>{
        if(err) {console.log(err)};
        res.send(alarms);
      })
});

app.get('alarm/pending', (req, res) => {
    Alarm.find({backGroundColor: 'Pending'}).then((alarms, err)=>{
        if(err) {console.log(err)};
        res.send(alarms);
      })
});