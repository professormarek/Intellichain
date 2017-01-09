/*
Copyright 2017 Marek Laskowski

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

pragma solidity ^0.4.7;
//v0.1
contract ABM{
	struct Agent{
		bytes1 state;
		uint64 uid;
		uint64 infectiousPeriod;//seconds
		uint64 timeInfected;
		uint64 contactsPerTimeStep;//TODO:function of location
		uint64 currentLocation;
		uint64 nextLocationChoice;
		address account;
		string nickName;
		mapping(uint64 => uint64[]) movements;
	}

	struct Location{
		uint64 uid;
		uint64[] visitorIds;
		//string description;
	}

	event modelCreated(uint64 order, uint64 betaN, uint64 betaD, uint64 locs, uint64 tStep, uint64 seed, uint64 cases);
	event agentAdded(uint64 order, uint64 id, uint64 initialLocation, uint64 contacts, string name, bytes1 state);
	event agentInfected(uint64 order, uint64 infector, uint64 susceptible, uint64 infectiousPeriod);
	event agentRecovered(uint64 order, uint64 id);
	event agentMoved(uint64 order, uint64 agentID, uint64 oldLocation, uint64 newLocation);
	event simulationStep(uint64 order, uint64 currentTime, uint64 infectedAgents, uint64 totalAgents);
	event movementDataRecord(uint64 order, uint64 agentID, uint64 oldLocation, uint64 newLocation, uint64 times);

	mapping (uint64 => Agent) agents;
	mapping (uint64 => Location) locations;

	uint64 private lfsr;
	uint64 timestep; //seconds
	uint64 timeElapsed;

	uint64 betaNumerator;
	uint64 betaDenominator;

	uint64 agentCount;
	uint64 infectedAgentCount;
	uint64 locationCount;

	uint64 constant infectousPeriodMinSeconds = 95000;//based on epi
	uint64 constant infectousPeriodMaxSeconds = 441000;//based on epi

	uint64 targetInitialCases; //how many agents will begin infected
	uint64 initialCasesCount;

	uint64 logEventOrder;

	function getAgentCount() constant returns(uint64 count){
		return agentCount;
	}
	function getInfectedAgentCount() constant returns(uint64 count){
		return infectedAgentCount;
	}
	function getElapsedSimulatedTime() constant returns(uint64 time){
		return timeElapsed;
	}

	function ABM(uint betaN, uint betaD, uint locs, uint tStep, uint seed, uint cases){
		betaNumerator = uint64(betaN);
		betaDenominator = uint64(betaD);
		timestep = uint64(tStep);
		timeElapsed = 0;
		if(seed != 0){
			lfsr = uint64(seed);
		}else{
			lfsr = 0xE2D3C4B6A7F09851;//magic number
		}
		agentCount = 0;
		infectedAgentCount= 0;
		//initialize locations
		locationCount = uint64(locs);
		for(uint64 i = 1; i <= locationCount; i++){
			locations[i].uid = i;
		}
		//infect the first targetInitialCases agents
		initialCasesCount = 0;
		targetInitialCases = uint64(cases);

		//tumble the RNG a bit
		for(i = 0; i < 64; i++){
			rand();
		}
		logEventOrder = 0;
		modelCreated(logEventOrder++, uint64(betaN), uint64( betaD), uint64( locs), uint64( tStep), uint64(  seed), uint64( cases));
	}



	function addAgent(uint initialLocation, uint contacts, string name){

		//generate a new uid for this agent
		uint64 id = ++agentCount;
		agents[id].uid = id;
		agents[id].contactsPerTimeStep = uint64(contacts);
		agents[id].currentLocation = uint64(initialLocation);
		locations[agents[id].currentLocation].visitorIds.push(id);
		agents[id].nextLocationChoice = 0;//invalid!
		agents[id].account = msg.sender;
		agents[id].nickName = name;
		//initialize agent initial state according to settings
		if(initialCasesCount < targetInitialCases){
			initialCasesCount++;
			infectedAgentCount++;
			agents[id].state = 'I';
			agents[id].infectiousPeriod =
			sampleUniform(infectousPeriodMinSeconds, infectousPeriodMaxSeconds);
		}else{
			agents[id].state = 'S';
			agents[id].infectiousPeriod = 0; //initialize when infection happens!
		}
		agents[id].timeInfected =0;
		//initialize movement table
		for(uint64 i = 1; i <= locationCount; i++){
			agents[id].movements[i] = new uint64[](locationCount+1);
		}
		agentAdded(logEventOrder++, agents[id].uid, agents[id].currentLocation, agents[id].contactsPerTimeStep, agents[id].nickName, agents[id].state);
	}

	function observeMovement(uint agentId, uint fromLocation, uint toLocation, uint times){
		//store movement in agent's table
		agents[uint64(agentId)].movements[uint64(fromLocation)][uint64(toLocation)]+= uint64(times);
		//record sum of observations in the first column
		agents[uint64(agentId)].movements[uint64(fromLocation)][0]+= uint64(times);
		movementDataRecord(logEventOrder++, uint64(agentId), uint64(fromLocation), uint64(toLocation), uint64(times) );

	}

	function tick(){
		uint64 infectedAgents = 0;
		uint64 totalAgents = 0;

		for(uint64 i = 1; i <= agentCount; i++){
			if(agentTick(i) == 'I'){
				infectedAgents++;
			}
			totalAgents++;
		}
		
		for(i = 1; i <= agentCount; i++){
			moveAgent(i);
		}
		
		timeElapsed += timestep;
		simulationStep(logEventOrder++, timeElapsed, infectedAgents, totalAgents);
	}

	function agentTick(uint64 id)
	private
	returns (bytes1 state){
		if(agents[id].state == 'I'){
			agents[id].timeInfected += timestep;
			if(agents[id].timeInfected > agents[id].infectiousPeriod){
				agents[id].state = 'R';
				infectedAgentCount--;
				agentRecovered(logEventOrder++, id);
			}else{
				infectiousContacts(id);
			}
		}
		chooseNewLocation(id);
		return agents[id].state;
	}

	function infectiousContacts(uint64 id)
	private{
		uint64 count = uint64(locations[agents[id].currentLocation].visitorIds.length);
		//if alone at the location, return
		if(count > 1){
			uint64 choice;
			for(int i = 0; i < agents[id].contactsPerTimeStep; i++){
				choice = sampleUniform(0,count);
				choice = locations[agents[id].currentLocation].visitorIds[choice];
				infectAgent(id, choice);
			}
		}
	}

	function chooseNewLocation(uint64 id)
	private{
		//TODO: use agents[id].movements[agents[id].currentLocation][0] for sample!
		if(agents[id].movements[agents[id].currentLocation][0] > 0){
			uint64 sample = sampleUniform(1,agents[id].movements[agents[id].currentLocation][0]+1); //wrong!
			uint64 sum = 0;
			uint64 loc = 0;
			while(sum < sample){
				loc++;
				sum += agents[id].movements[agents[id].currentLocation][loc];
			}
			agents[id].nextLocationChoice = locations[loc].uid;
		}else{
			agents[id].nextLocationChoice = locations[sampleUniform(1,locationCount+1)].uid;
		}
		

	}

	function infectAgent(uint64 infector, uint64 susceptible)
	private{
		if(agents[susceptible].state == 'S'){
			//perform a Bernoulli trial
			if(sampleUniform(0, betaDenominator) < betaNumerator){
				agents[susceptible].state = 'I';
				agents[susceptible].timeInfected = 0;
				infectedAgentCount++;
				agents[susceptible].infectiousPeriod =
				sampleUniform(infectousPeriodMinSeconds, infectousPeriodMaxSeconds);
				agentInfected(logEventOrder++, infector,  susceptible, agents[susceptible].infectiousPeriod);
			}
		}
	}

	function moveAgent(uint64 mover) 
	private {
		uint64 currentLocation = agents[mover].currentLocation;
		uint64 i = 0;
		while(i < locations[currentLocation].visitorIds.length &&
			locations[currentLocation].visitorIds[i] != mover){
			i++;
		}
		if(i < locations[currentLocation].visitorIds.length){
			//replace current id with the last one in the list; shorten list
			if(locations[currentLocation].visitorIds.length > 1){
				locations[currentLocation].visitorIds[i] = 
				locations[currentLocation].visitorIds[locations[currentLocation].visitorIds.length - 1] ;
			}
			locations[currentLocation].visitorIds.length -= 1;
		}
		if (agents[mover].nextLocationChoice == 0){
			agents[mover].nextLocationChoice =
			locations[sampleUniform(1,locationCount+1)].uid;
		}
		agents[mover].currentLocation = agents[mover].nextLocationChoice;
		locations[agents[mover].currentLocation].visitorIds.push(mover);
		agentMoved(logEventOrder++, mover, currentLocation, agents[mover].currentLocation);

	}

	/*
	returns a number between min (inclusive) and max (not inclusive)
	*/
	function sampleUniform(uint64 min, uint64 max)
	private
	returns (uint64 sample){
		if(max - min < 2){
			return min;
		}
		return min + rand() % (max - min);
	}

	function rand()
	private
	returns (uint64 random){
		uint64 lsb = lfsr & 1;
		lfsr = lfsr >> 1;
		if(lsb == 1){
			lfsr = lfsr ^ 0xD800000000000000;
		}
		return lfsr;
	}


}
