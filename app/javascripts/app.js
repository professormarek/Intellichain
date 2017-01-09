var accounts;
var account;

var events = [];

var data;
var graphReady = false;
function setStatus(message) {
  var status = document.getElementById("status");
  status.innerHTML = message;
};

function refreshStats() {
  var meta = ABM.deployed();
  var hoursElapsed = 0;
  var infections = 0;

  meta.getAgentCount.call().then(function(value) {
    var agentCountElement = document.getElementById("agentCount");
    agentCountElement.innerHTML = value.valueOf();
  }).catch(function(e) {
    console.log(e);
    setStatus("Error getting agent count; see log.");
  });

  meta.getInfectedAgentCount.call().then(function(value2) {
    var infectedAgentCountElement = document.getElementById("infectedAgentCount");
    infectedAgentCountElement.innerHTML = value2.valueOf();
    infections = value2.valueOf();
  }).catch(function(e) {
    console.log(e);
    setStatus("Error getting infected agent count; see log.");
  });

  //simTime
  meta.getElapsedSimulatedTime.call().then(function(value3) {
    var elapsedTimeElement = document.getElementById("simTime");
    elapsedTimeElement.innerHTML = value3.valueOf();
    hoursElapsed = value3.valueOf() / 3600;
  }).catch(function(e) {
    console.log(e);
    setStatus("Error getting simulation time; see log.");
  });
  
};

function refreshEvents() {
  var meta = ABM.deployed();

  events.sort(function(a,b){
    var aTokens = a.split(",");
    var bTokens = b.split(",");
    var ao = parseInt(aTokens[0]);
    var bo = parseInt(bTokens[0]);
    //console.log("comparing " + ao + " and " + bo);
    return ao - bo;
  });

  var ul = document.getElementById("eventList");
  while (ul.firstChild) {
      ul.removeChild(ul.firstChild);
  }
  for(var eventCount=0; eventCount<events.length; eventCount++){
    var li = document.createElement("li");
    li.appendChild(document.createTextNode(events[eventCount]));
    var id = "event" + eventCount;
    li.setAttribute("id", id);
    ul.appendChild(li);
  }
}

function refreshGraph(hoursElapsed, infectedCount){
  //(min, max) = data.getColumnRange(0);
  //if(hoursElapsed > max){
    console.log("adding row to data " + hoursElapsed + ", " + infectedCount + " DATA " + data);
    data.addRow([hoursElapsed, infectedCount]);
    data.sort([{column: 0}]);
  //}

  var options = {
        hAxis: {
          title: 'Time (hours)'
        },
        vAxis: {
          title: 'Count'
        },
        backgroundColor: '#f1f8e9'
      };

      var chart = new google.visualization.LineChart(document.getElementById('chart_div'));
      chart.draw(data, options);
}

function drawBackgroundColor() {
      data = new google.visualization.DataTable();
      data.addColumn('number', 'Time');
      data.addColumn('number', 'Infections');

      var options = {
        hAxis: {
          title: 'Time (hours)'
        },
        vAxis: {
          title: 'Count'
        },
        backgroundColor: '#f1f8e9'
      };

      var chart = new google.visualization.LineChart(document.getElementById('chart_div'));
      chart.draw(data, options);
      graphReady = true;
    }


function advanceTime(){
  var meta = ABM.deployed();
  var timeSteps = parseInt(document.getElementById("timeSteps").value);
  if(timeSteps < 1 || isNaN(timeSteps)){
    timeSteps = 1;
  }

  setStatus("calling tick() " + timeSteps + " to advance the time..." + timeSteps + " hours");

  for(var step=1; step<=timeSteps; step++){
    (function(){ //this closure or whatever is to capture the value of projectCount
      var i = step;


      meta.tick({from: account, gas:3000000, value: 0}).then(function(result){
        setStatus("final call to tick() complete!");
        console.log("returned from tick() result is: " +result );
        refreshStats();

        return web3.eth.getTransactionReceiptMined(result);                                                                    


      }).catch(function(e) {
        console.log(e);
        setStatus("Error while calling tick(); see log.");
      });
    })(); //extra closure or whatever to caputre the current value of projectCount
  }


};

function addMovement(){
  var meta = ABM.deployed();

  var agentId = parseInt(document.getElementById("agentId").value);
  var fromLocation = parseInt(document.getElementById("fromLocation").value);
  var toLocation = parseInt(document.getElementById("toLocation").value);
  var times = parseInt(document.getElementById("times").value);

  setStatus("calling observeMovement() for agent: " + agentId + " moving from location " + fromLocation + " to location " + toLocation + " times " + times);
  meta.observeMovement(agentId, fromLocation, toLocation, times, {from: account, gas:3000000, value: 0}).then(function(result){
    setStatus("observeMovement() complete!");
    console.log("returned from observeMovement() result is: " +result );
    refreshStats();
    return web3.eth.getTransactionReceiptMined(result);                                                                    


  }).catch(function(e) {
    console.log(e);
    setStatus("Error while calling observeMovement(); see log.");
  });
  
 
}

function addAgent(){
  var meta = ABM.deployed();

  var agentName = document.getElementById("agentName").value;
  var agentInitialLocation = parseInt(document.getElementById("agentInitialLocation").value);
  var agentNumContacts = parseInt(document.getElementById("agentNumContacts").value);

  setStatus("calling addAgent() for agent: " + agentName + " initial location " + agentInitialLocation + " contacts per time step " + agentNumContacts);
  meta.addAgent(agentInitialLocation, agentNumContacts, agentName, {from: account, gas:3000000, value: 0}).then(function(result){
    setStatus("addAgent() complete!");
    console.log("returned from addAgent() result is: " +result );
    refreshStats();
    return web3.eth.getTransactionReceiptMined(result);                                                                    


  }).catch(function(e) {
    console.log(e);
    setStatus("Error while calling addAgent(); see log.");
  });
}

window.onload = function() {
  web3.eth.getAccounts(function(err, accs) {
    if (err != null) {
      alert("There was an error fetching your accounts.");
      return;
    }

    if (accs.length == 0) {
      alert("Couldn't get any accounts! Make sure your Ethereum client is configured correctly.");
      return;
    }

    accounts = accs;
    account = accounts[0];

    refreshStats();
  });

  web3.eth.getTransactionReceiptMined = function (txnHash, interval) {
        var transactionReceiptAsync;
        interval = interval ? interval : 500;
        transactionReceiptAsync = function(txnHash, resolve, reject) {
            try {
                var receipt = web3.eth.getTransactionReceipt(txnHash);
                if (receipt == null) {
                    setTimeout(function () {
                               transactionReceiptAsync(txnHash, resolve, reject);
                    }, interval);
                } else {
                    console.log("transaction completed; gas used: " + receipt.gasUsed );
                    console.log(receipt);
                    refreshStats();

                    resolve(receipt);
                }
            } catch(e) {
                reject(e);
            }
        };
        
        if (Array.isArray(txnHash)) {
            var promises = [];
            txnHash.forEach(function (oneTxHash) {
                            promises.push(web3.eth.getTransactionReceiptMined(oneTxHash, interval));
                            });
            return Promise.all(promises);
        } else {
            return new Promise(function (resolve, reject) {
                               transactionReceiptAsync(txnHash, resolve, reject);
                               });
        }
    };

  var meta = ABM.deployed();

  var agentAdded = meta.agentAdded({fromBlock: web3.eth.blockNumber, toBlock: 'latest'});
  agentAdded.watch(function(error, result) {
    if (error == null) {
       var tempState = String.fromCharCode(result.args.state);
       console.log("Agent Added: id: " + result.args.id.valueOf() + " at location: "  + result.args.initialLocation.valueOf() + " contacts per time step: " + result.args.contacts.valueOf() + " nickname: " + result.args.name + " initial state: " + tempState);
       events.push(""+result.args.order.valueOf()+", AGENT_ADDED, "+result.args.id.valueOf() + ", "  + result.args.initialLocation.valueOf() + ", " + result.args.contacts.valueOf() + ", " + result.args.name + ", " + tempState);
       refreshEvents();
       return true;
    }else{
        console.log(error);
    }
  });

  var agentInfected = meta.agentInfected({fromBlock: web3.eth.blockNumber, toBlock: 'latest'});
  agentInfected.watch(function(error, result) {
    if (error == null) {
       console.log("Agent Infected: id: " + result.args.susceptible.valueOf() + " by agent: "  + result.args.infector.valueOf() + " new infectious period: " + result.args.infectiousPeriod.valueOf() );
       events.push(""+result.args.order.valueOf()+", AGENT_INFECTED, " + result.args.susceptible.valueOf() + ", "  + result.args.infector.valueOf() + ", " + result.args.infectiousPeriod.valueOf() );
       refreshEvents();
       return true;
    }else{
        console.log(error);
    }
  });

  var agentRecovered = meta.agentRecovered({fromBlock: web3.eth.blockNumber, toBlock: 'latest'});
  agentRecovered.watch(function(error, result) {
    if (error == null) {
       console.log("Agent Recovered: id: " + result.args.id.valueOf() );
       events.push(""+result.args.order.valueOf()+", AGENT_RECOVERED, " + result.args.id.valueOf() );
       refreshEvents();
       return true;
    }else{
        console.log(error);
    }
  });

  var agentMoved = meta.agentMoved({fromBlock: web3.eth.blockNumber, toBlock: 'latest'});
  agentMoved.watch(function(error, result) {
    if (error == null) {
       console.log("Agent Moved: id: " + result.args.agentID.valueOf() + " from location: "  + result.args.oldLocation.valueOf() + " to location: "  + result.args.newLocation.valueOf());
       events.push(""+result.args.order.valueOf()+", AGENT_MOVED, " + result.args.agentID.valueOf() + ", "  + result.args.oldLocation.valueOf() + ", "  + result.args.newLocation.valueOf());
       refreshEvents();
       return true;
    }else{
        console.log(error);
    }
  });

  var simulationStep = meta.simulationStep({fromBlock: web3.eth.blockNumber, toBlock: 'latest'});
  simulationStep.watch(function(error, result) {
    if (error == null) {
       console.log("Simulation advanced: new time (seconds): " + result.args.currentTime.valueOf() + " infected agents: "  + result.args.infectedAgents.valueOf() + " total agents: "  + result.args.totalAgents.valueOf());
       events.push(""+result.args.order.valueOf()+", TIME_STEP, " + result.args.currentTime.valueOf() + ", "  + result.args.infectedAgents.valueOf() + ", "  + result.args.totalAgents.valueOf());
       refreshEvents();
       refreshStats();
       if(graphReady){
          var hoursElapsed = result.args.currentTime.valueOf() / 3600;
          var infected = result.args.infectedAgents.valueOf() / 1;
          refreshGraph(hoursElapsed, infected);
        }
       return true;
    }else{
        console.log(error);
    }
  });


  var movementDataRecord = meta.movementDataRecord({fromBlock: web3.eth.blockNumber, toBlock: 'latest'});
  movementDataRecord.watch(function(error, result) {
    if (error == null) {
       console.log("Recording movement for agent: id: " + result.args.agentID.valueOf() + " from location: "  + result.args.oldLocation.valueOf() + " to location: "  + result.args.newLocation.valueOf() + " number of observed movements: "  + result.args.times.valueOf());
       events.push(""+result.args.order.valueOf()+", OBSERVE_MOVEMENT, " + result.args.agentID.valueOf() + ", "  + result.args.oldLocation.valueOf() + ", "  + result.args.newLocation.valueOf() + ", "  + result.args.times.valueOf());
       refreshEvents();
       return true;
    }else{
        console.log(error);
    }
  });

  google.charts.load('current', {packages: ['corechart', 'line']});
google.charts.setOnLoadCallback(drawBackgroundColor);  


}
