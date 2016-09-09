var Game = require('./db-config').Game;
var Location = require('./db-config').Location;
var Status = require('./db-config').Status;
var User = require('./db-config').User;
var Utils = require('./utils');
var express = require('express');
var jwtauth = require('./jwt');
var md5 = require('md5');
var jwt = require('jwt-simple');

module.exports = function(app, express) {

  var requireAuth = function(req, res, next) {
    //jwt adds user struct to req - if not there user was not validated
    if (!req.user.username) {
      res.end('Not authorized', 401);
    } else {
      next();
    }
  }

  app.get('/api/game', jwtauth, requireAuth, function(req, res) {
    if (req.query.path) {
      // do a query for gameId and username
      // return game info for username

      //Looks in usergame table to see if player is in game
      Game.findOne({
        where: {path: req.query.path},
        include: [{
          model: User,
          where: { username: req.user.username },
        }]
      }).then(function (gameFound) {
        //if the user was not in the game, have player join the game
        if (!gameFound) {
          // function (User, req.query.username) 
          User.findOne({
            where: { username: req.user.username }
          })
          .then( function (currentUser) {
            Game.findOne({
              where: { path: req.query.path }
            })
            .then(function (currentGame) {
              var gameId = currentGame.id;
              if (currentGame) {
                //Adds to the usergame relation table
                currentUser.addGame(currentGame);
                console.log('Joined the game');

                // Find all locations of the Game
                Location.findAll({
                  include: [{
                    model: Game,
                    where: {id: gameId}
                  }]
                })
                .then( function (allLoc) {
                  //force async of creation of locations for user
                  var asyncCounter = 0;
                  //For each location of each game, create a status row linked to both and set default status to false
                  allLoc.forEach(function (eachLoc) {
                    currentUser.addLocation(eachLoc)
                    .then( function (elem) {
                      Status.update({ status: false },
                      { where: {
                        locationId: elem[0][0].dataValues.locationId,
                        userId: elem[0][0].dataValues.userId,
                      }}).then(function() {
                        asyncCounter++;
                        if (asyncCounter === allLoc.length) {
                          User.findOne({
                            attributes: [],
                            where: {
                              username: req.user.username
                            },
                            include: [{
                              model: Location,
                              where: {
                                gameId: gameId
                              }
                            }]
                          }).then(function(result) {
                            res.send(result);
                          });
                        }
                      });
                    });
                  });
                });
              }
            });
          });
          // if (!gameFound)
        } else {
          
          User.findOne({
            attributes: [],
            where: {
              username: req.user.username
            },
            include: [{
              model: Location,
              where: {
                gameId: gameFound.id
              }
            }]
          }).then(function(result) {
            res.send(result);
          });
        }

      });
    } else {  
      Game.findAll({
        include: [{
          model: User,
          where: { username: req.user.username },
        }],
        raw: true
      }).then(function(allGames) {
        res.send(allGames);
      });

    }
  });

  app.put('/api/game', jwtauth, requireAuth, function (req, res) {
    User.findOne({
      where: {
        username: req.user.username
      }
    })
    .then(function (currentUser) {
      Status.findOne({
        where: {
          userId: currentUser.id,
          locationId: req.body.locationId,
        }
      }).then(function(currentStatus) {
        currentStatus.update({
          status: true
        }).then(function(result) {
          res.send(result);
        });
      });

    })
    // res.send('This is the POST for /game');

  });

  app.post('/api/game/create', jwtauth, requireAuth, function (req, res) {

    // Example Data Structure
    // { 'username': 'beth',
    //   'markers': [
    //     { latitude: 1.23, longitude: 2.34, sequence: 1},
    //     { latitude: 3.45, longitude: 4.56, sequence: 2},
    //     { latitude: 5.67, longitude: 6.78, sequence: 3},
    //     { latitude: 7.89, longitude: 8.90, sequence: 4} ]
    // };

    var creator = req.user.username;

    // generate pathUrl Hash
    var pathUrl = md5(JSON.stringify(req.body))

    var locations = req.body.markers;

    User.findOne({ where: { username: creator } })
    .then(function(currentUser) {
      Game.create({
        creatorId: currentUser.dataValues.id,
        path: pathUrl,
        locations: locations
      }, { include: [Location] })
      .then(function(game) {
      res.send(pathUrl);
      });
    });

  });

  app.post('/api/users/signup', function(req, res) {

    if (req.headers.username && req.headers.password) {   
       var user = {
        username : req.headers.username.toLowerCase(),
        password : req.headers.password
      };
      
      // create it
      Utils.encryptPassword(user, function(err, user) {
         User.create(user)
        .then(function(user, created) {
          // create token and return
          var secret = 'teambsAThackreactor47';
          Utils.createToken(user, secret, function(token) {
            if ( token.token ) {
              res.status(201).send(token);
            } else {
              res.status(401).send('Token error');
            }
          });  
        })
        .catch(function(err) {
          res.status(409).send('Username already exists or other err: '+ err);
        });
      });
    } else {
      // missing username or password
      res.status(401).send('missing username or password');
    }
  }); // end of signup

  app.post('/api/users/login', function(req, res) {
    if (req.headers.username && req.headers.password) {      
      // Fetch the appropriate user, if they exist

      User.findOne({where: { username: req.headers.username }})
      .then(function(user) {
        if(user) {
          Utils.comparePassword(req.headers.password, user, function(err, isMatch) {
            if (err) {            
              // bad password
              res.status(401).send('Authentication error');
            } else if (isMatch) {  
              // has successfully authenticated, send a token
              var secret = 'teambsAThackreactor47';
              Utils.createToken(user, secret, function(token) {
                if ( token.token ) {
                  res.status(200).send(token);
                } else {
                  res.status(401).send('Token error');
                }
              });   
            } else {            
              res.status(401).send('Authentication error');
            }
          }); // comparePassword
        }
        else { // User does not exist in db.
          res.status(401).send('Authentication error');
        }
      }) // .then findOne
      .error(function(err) {   
        res.status(401).send('Authentication error');
      }); // .error findOne
    } else {
      res.status(401).send('Authentication error');
    }
  });
};
