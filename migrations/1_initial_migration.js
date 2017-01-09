module.exports = function(deployer) {
  deployer.deploy(Migrations, { gas: 3000000 });
};
