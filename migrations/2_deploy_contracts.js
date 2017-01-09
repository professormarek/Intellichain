module.exports = function(deployer) {
	/*
  deployer.deploy(ABM,1000,2000,5,3600,0,1).then(function(){
  	return ABM.deployed().addAgent(1,2,"bob");
  }).then(function(){
  	return ABM.deployed().addAgent(2,3,"alice");
  }).then(function(){
  	return ABM.deployed().addAgent(3,2,"joey");
  }).then(function(){
  	return ABM.deployed().addAgent(4,3,"jojojr");
  }).then(function(){
  	return ABM.deployed().addAgent(5,3,"shabadoo");
  });
  */
  /*
  deployer.deploy(ABM,1000,2000,3,3600,0,1).then(function(){
  	return ABM.deployed().addAgent(3,2,"bob");
  }).then(function(){
  	return ABM.deployed().observeMovement(1,1,2);
  }).then(function(){
  	return ABM.deployed().observeMovement(1,2,3);
  }).then(function(){
  	return ABM.deployed().observeMovement(1,3,1);
  }).then(function(){
  	return ABM.deployed().observeMovement(1,3,2);
  });
  */
  /*
  deployer.deploy(ABM,1000,50000,7,3600,0,2, { gas: 3000000 }).then(function(){
    return ABM.deployed().addAgent(1,2,"One");
  }).then(function(){
    return ABM.deployed().addAgent(2,1,"Two");
  }).then(function(){
    return ABM.deployed().addAgent(7,3,"Three");
  }).then(function(){
    return ABM.deployed().addAgent(4,1,"Four");
  }).then(function(){
    return ABM.deployed().addAgent(6,1,"Five");
  }).then(function(){
    return ABM.deployed().addAgent(4,2,"Six");
  }).then(function(){
    return ABM.deployed().addAgent(2,4,"Seven");
  }).then(function(){
    return ABM.deployed().addAgent(3,3,"Eight");
  }).then(function(){
    return ABM.deployed().addAgent(5,1,"Nine");
  }).then(function(){
    return ABM.deployed().addAgent(6,3,"Ten");
  });
  */
  deployer.deploy(ABM,1000,40000,7,3600,0,1, { gas: 3000000 });
  /*
  deployer.deploy(ABM,1000,40000,7,3600,0,1, { gas: 3000000 }).then(function(){
  ABM.deployed().addAgent(1,2,"One");
  ABM.deployed().addAgent(2,1,"Two");
  ABM.deployed().addAgent(7,3,"Three");
  ABM.deployed().addAgent(4,1,"Four");
  ABM.deployed().addAgent(6,1,"Five");
  ABM.deployed().addAgent(4,2,"Six");
  ABM.deployed().addAgent(2,4,"Seven");
  ABM.deployed().addAgent(3,3,"Eight");
  ABM.deployed().addAgent(5,1,"Nine");
  ABM.deployed().addAgent(6,3,"Ten");
  });
  */

};
