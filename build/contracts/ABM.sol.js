var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("ABM error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("ABM error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("ABM contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of ABM: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to ABM.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: ABM not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "1": {
    "abi": [
      {
        "constant": true,
        "inputs": [],
        "name": "getInfectedAgentCount",
        "outputs": [
          {
            "name": "count",
            "type": "uint64"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "tick",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getAgentCount",
        "outputs": [
          {
            "name": "count",
            "type": "uint64"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "agentId",
            "type": "uint256"
          },
          {
            "name": "fromLocation",
            "type": "uint256"
          },
          {
            "name": "toLocation",
            "type": "uint256"
          },
          {
            "name": "times",
            "type": "uint256"
          }
        ],
        "name": "observeMovement",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "initialLocation",
            "type": "uint256"
          },
          {
            "name": "contacts",
            "type": "uint256"
          },
          {
            "name": "name",
            "type": "string"
          }
        ],
        "name": "addAgent",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getElapsedSimulatedTime",
        "outputs": [
          {
            "name": "time",
            "type": "uint64"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "betaN",
            "type": "uint256"
          },
          {
            "name": "betaD",
            "type": "uint256"
          },
          {
            "name": "locs",
            "type": "uint256"
          },
          {
            "name": "tStep",
            "type": "uint256"
          },
          {
            "name": "seed",
            "type": "uint256"
          },
          {
            "name": "cases",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "betaN",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "betaD",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "locs",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "tStep",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "seed",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "cases",
            "type": "uint64"
          }
        ],
        "name": "modelCreated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "id",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "initialLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "contacts",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "state",
            "type": "bytes1"
          }
        ],
        "name": "agentAdded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infector",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "susceptible",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infectiousPeriod",
            "type": "uint64"
          }
        ],
        "name": "agentInfected",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "id",
            "type": "uint64"
          }
        ],
        "name": "agentRecovered",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          }
        ],
        "name": "agentMoved",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "currentTime",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infectedAgents",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "totalAgents",
            "type": "uint64"
          }
        ],
        "name": "simulationStep",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "times",
            "type": "uint64"
          }
        ],
        "name": "movementDataRecord",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060405234620000005760405160c080620019c983398101604090815281516020830151918301516060840151608085015160a090950151929491929091905b60028054600380546001604060020a0319166001604060020a0389811691909117909155600160c060020a0390911678010000000000000000000000000000000000000000000000008983160217604060020a608060020a031916680100000000000000009186169190910217608060020a60c060020a031916905560008215620000e657600280546001604060020a0319166001604060020a03851617905562000101565b600280546001604060020a03191667e2d3c4b6a7f098511790555b50600380546001604060020a03868116780100000000000000000000000000000000000000000000000002911617905560015b6003546001604060020a0378010000000000000000000000000000000000000000000000009091048116908216116200019a576001604060020a038116600081815260016020526040902080546001604060020a03191690911790555b60010162000134565b50600480546001608060020a0319166001604060020a03831617905560005b6040816001604060020a03161015620001ef57620001e46401000000006200144f620002a182021704565b505b600101620001b9565b60048054700100000000000000000000000000000000608060020a60c060020a03199091168181046001604060020a03908116600181018216909302909117909255604080519182528983166020830152888316828201528783166060830152868316608083015285831660a083015291841660c082015290517ffc55679493421f362a8016519d44ecbd64447fb827ec54dd1a56121f8e2b9e0f9181900360e00190a15b5050505050505062000312565b600280546001604060020a03808216839004166001604060020a0319821617909155600090600190811690811415620002ff57600280546001604060020a031981166001604060020a0391821667d800000000000000189091161790555b6002546001604060020a031691505b5090565b6116a780620003226000396000f3006060604052361561005c5763ffffffff60e060020a600035041663017b328581146100615780633eaf5d9f1461008a57806391cab63e1461009957806395e71ad4146100c2578063a1b27aa4146100dd578063b5e3968d14610136575b610000565b346100005761006e61015f565b604080516001604060020a039092168252519081900360200190f35b3461000057610097610176565b005b346100005761006e6102bf565b604080516001604060020a039092168252519081900360200190f35b34610000576100976004356024356044356064356102d6565b005b3461000057604080516020600460443581810135601f810184900484028501840190955284845261009794823594602480359560649492939190920191819084018382808284375094965061043a95505050505050565b005b346100005761006e610a84565b604080516001604060020a039092168252519081900360200190f35b600354608060020a90046001604060020a03165b90565b60008060015b6003546001604060020a03604060020a9091048116908216116101e8576101a281610a9b565b7effffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff191660f860020a60490214156101d9576001909201915b6001909101905b60010161017c565b5060015b6003546001604060020a03604060020a90910481169082161161021b5761021281610c2e565b5b6001016101ec565b60028054608060020a8082046001604060020a03908116604060020a840482160181168202608060020a60c060020a0319938416179384905560048054838104831660018101841685029190951617905560408051938452919093048316602083015285831682820152918416606082015290517f5a6e5ec3bf040ed041d47a7b57dbb50b489a1c7335df9cb405bd97d610e8916e9181900360800190a15b505050565b600354604060020a90046001604060020a03165b90565b6001604060020a0380851660009081526020818152604080832087851684526004019091529020805483928516908110156100005790600052602060002090600491828204019190066008025b81546101009190910a6001604060020a038181021983169282900481169490940184160217905584811660009081526020818152604080832093871683526004909301905290812080548392908110156100005790600052602060002090600491828204019190066008025b81546101009190910a6001604060020a038181021983169282900481169490940184160217905560048054608060020a60c060020a03198116608060020a91829004841660018101851690920217909155604080519182528683166020830152858316828201528483166060830152918316608082015290517fee4d43072717ac1a93988c369bc2e5ecc85a8214bc29e77c32b373ae5b452b589160a0908290030190a15b50505050565b600380546fffffffffffffffff000000000000000019808216604060020a928390046001604060020a03908116600190810180831680870294909417909655600083815260208181526040808320805468ffffffffffffffff001916610100909702969096178655948301805467ffffffffffffffff19168b8616179096168b8516880217958690559590940490911683529283905281208201805492830180825591929091828183801582901161052757600301600490048160030160049004836000526020600020918201910161052791905b80821115610523576000815560010161050f565b5090565b5b50505091600052602060002090600491828204019190066008025b81546001604060020a0380871661010093840a81810292021990921617909255600091825260208281526040832060018181018054608060020a60c060020a03191690556002808301805473ffffffffffffffffffffffffffffffffffffffff331673ffffffffffffffffffffffffffffffffffffffff1990911617905589516003909301805481885296859020909750601f928716159095026000190190951694909404840182900483019390929188019083901061060e57805160ff191683800117855561063b565b8280016001018555821561063b579182015b8281111561063b578251825591602001919060010190610620565b5b5061065c9291505b80821115610523576000815560010161050f565b5090565b50506004546001604060020a03808216604060020a90920416101561075657600480546fffffffffffffffff0000000000000000198116604060020a918290046001604060020a03908116600190810182169093029190911790925560038054608060020a60c060020a03198116608060020a91829004851690930184160291909117905582166000908152602081905260409020805460ff1916604917905561070c620173186206baa86110a5565b6001604060020a038381166000908152602081905260409020805470ffffffffffffffff00000000000000000019166901000000000000000000939092169290920217905561078e565b6001604060020a0382166000908152602081905260409020805460ff191660531770ffffffffffffffff000000000000000000191690555b506001604060020a03811660009081526020819052604090208054608860020a67ffffffffffffffff021916905560015b6003546001604060020a0360c060020a90910481169082161161092957600360189054906101000a90046001604060020a03166001016001604060020a031660405180591061080b5750595b908082528060200260200182016040525b506001604060020a038084166000908152602081815260408083209386168352600493840182528220845181548183558285529383902091956003909401949094048101939290910182156108f35791602002820160005b838211156108be57835183826101000a8154816001604060020a0302191690836001604060020a031602179055509260200192600801602081600701049283019260010302610874565b80156108f15782816101000a8154906001604060020a0302191690556008016020816007010492830192600103026108be565b505b5061091e9291505b8082111561052357805467ffffffffffffffff191681556001016108fb565b5090565b50505b6001016107bf565b6004805460016001604060020a03608060020a80840482168381018316909102608060020a60c060020a0319909416939093179093558483166000908152602081815260409182902080548185015484518781526101008084048a16958201869052604060020a83048a169682018790529190981660608901819052600160f860020a031960f860020a90930292831660a08a015260c060808a018181526003909501805460026000199a82161590950299909901909816929092049189018290527f37bac8e66dacf996f814135957cf16d22b8897281288666a7bb86d5eb9dcf2cb98949690949093909160e083019085908015610a695780601f10610a3e57610100808354040283529160200191610a69565b820191906000526020600020905b815481529060010190602001808311610a4c57829003601f168201915b505097505050505050505060405180910390a15b5050505050565b600254608060020a90046001604060020a03165b90565b6001604060020a03811660009081526020819052604081205460f860020a02600160f860020a03191660f860020a6049021415610bfd576002546001604060020a0383811660009081526020819052604090208054710100000000000000000000000000000000008082048416604060020a90950484169490940183168402608860020a67ffffffffffffffff02199091161790819055690100000000000000000081048216929004161115610bf4576001604060020a0382811660008181526020818152604091829020805460ff1916605217905560038054608060020a60c060020a0319808216608060020a9283900488166000190188168302179092556004805492831692829004871660018101909716909102919091179055815193845283019190915280517f445a4b6c3a89b88766d988d26ca839acfd3007f9ebf52b7f98e5bca76af8e9119281900390910190a1610bfd565b610bfd826110f1565b5b5b610c08826111f0565b506001604060020a03811660009081526020819052604090205460f860020a025b919050565b6001604060020a03808216600090815260208190526040812060010154604060020a9004909116905b6001604060020a0380831660009081526001602081905260409091200154908216108015610ce357506001604060020a038281166000908152600160208190526040909120018054828616928416908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a03166001604060020a031614155b15610cf057600101610c57565b6001604060020a03808316600090815260016020819052604090912001549082161015610e7a576001604060020a03821660009081526001602081905260409091208101541115610e06576001604060020a03821660009081526001602081905260409091200180546000198101908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a031660016000846001604060020a03166001604060020a03168152602001908152602001600020600101826001604060020a031681548110156100005790600052602060002090600491828204019190066008025b6101000a8154816001604060020a0302191690836001604060020a031602179055505b6001604060020a03821660009081526001602081905260409091200180546000198101808355919082908015829011610e74576003016004900481600301600490048360005260206000209182019101610e7491905b80821115610523576000815560010161050f565b5090565b5b505050505b6001604060020a03808416600090815260208190526040902060010154608060020a9004161515610f1d5760016000610ecc6001600360189054906101000a90046001604060020a03166001016110a5565b6001604060020a0390811682526020808301939093526040918201600090812054878316825293819052919091206001018054608060020a60c060020a03191692909116608060020a029190911790555b6001604060020a0380841660009081526020818152604080832060019081018054604060020a608060020a8204881681026fffffffffffffffff000000000000000019909216919091179182905590049094168352908390529020810180549182018082559091908281838015829011610fcc576003016004900481600301600490048360005260206000209182019101610fcc91905b80821115610523576000815560010161050f565b5090565b5b50505091600052602060002090600491828204019190066008025b81546001604060020a038088166101009390930a838102908202199092169190911790925560048054608060020a808204851660018181018716909202608060020a60c060020a031990931692909217909255600083815260208181526040918290209093015481519283529282019390935286841681840152604060020a9091049092166060830152517ff8a972487b9e0fe9a7dd9e51da864d5f79ddacb7ee8b820f9934383059b0c88b92509081900360800190a15b505050565b600060028383036001604060020a031610156110c25750816110eb565b8282036001604060020a03166110d661144f565b6001604060020a031681156100005706830190505b92915050565b6001604060020a03808216600090815260208181526040808320600190810154604060020a9004851684529182905282208101549282919084161115610434575060005b6001604060020a0380851660009081526020819052604090206001015416811215610434576111656000846110a5565b6001604060020a03808616600090815260208181526040808320600190810154604060020a9004851684529182905290912001805492945091908416908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a031691506111df84836114c1565b5b600101611135565b5b5b50505050565b6001604060020a038082166000908152602081815260408083206001810154604060020a900490941683526004909301905290812080548291829182919082908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a03166001604060020a031611156113d0576001604060020a03808516600090815260208181526040808320600181810154604060020a90049095168452600401909152812080546112e59392908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a03166001016110a5565b925060009150600090505b826001604060020a0316826001604060020a03161015611385576001604060020a03808516600090815260208181526040808320600181810154604060020a900486168552600490910190925290912080549190930192918316908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a0316820191506112f0565b6001604060020a03818116600090815260016020818152604080842054898616855291849052909220018054608060020a60c060020a03191691909216608060020a02179055610434565b600160006113f76001600360189054906101000a90046001604060020a03166001016110a5565b6001604060020a0390811682526020808301939093526040918201600090812054888316825293819052919091206001018054608060020a60c060020a03191692909116608060020a029190911790555b5b50505050565b600280546001604060020a038082168390041667ffffffffffffffff198216179091556000906001908116908114156114ae576002805467ffffffffffffffff1981166001604060020a0391821667d800000000000000189091161790555b6002546001604060020a031691505b5090565b6001604060020a03811660009081526020819052604090205460f860020a02600160f860020a0319167f53000000000000000000000000000000000000000000000000000000000000001415611675576002546003546001604060020a0360c060020a90920482169161153791600091166110a5565b6001604060020a03161015611675576001604060020a038181166000908152602081905260409020805460ff1916604917608860020a67ffffffffffffffff021916905560038054608060020a60c060020a03198116608060020a918290048416600101909316029190911790556115b5620173186206baa86110a5565b6001604060020a0382811660008181526020818152604091829020805470ffffffffffffffff00000000000000000019166901000000000000000000968616870217815560048054608060020a60c060020a03198116608060020a9182900488166001810189169092021790915590548351918252888616928201929092528083019390935293909304909116606082015290517f4c0942992c4c10c70bdd9f06b65ea73d723904bdd14b81fc59b3ac1b5717d1d8916080908290030190a15b5b5b50505600a165627a7a7230582050719f8e256c12f90e727f7c84980f1900fe1c537e90f67218be23708b483a420029",
    "events": {
      "0xfc55679493421f362a8016519d44ecbd64447fb827ec54dd1a56121f8e2b9e0f": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "betaN",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "betaD",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "locs",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "tStep",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "seed",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "cases",
            "type": "uint64"
          }
        ],
        "name": "modelCreated",
        "type": "event"
      },
      "0x37bac8e66dacf996f814135957cf16d22b8897281288666a7bb86d5eb9dcf2cb": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "id",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "initialLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "contacts",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "state",
            "type": "bytes1"
          }
        ],
        "name": "agentAdded",
        "type": "event"
      },
      "0x4c0942992c4c10c70bdd9f06b65ea73d723904bdd14b81fc59b3ac1b5717d1d8": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infector",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "susceptible",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infectiousPeriod",
            "type": "uint64"
          }
        ],
        "name": "agentInfected",
        "type": "event"
      },
      "0x445a4b6c3a89b88766d988d26ca839acfd3007f9ebf52b7f98e5bca76af8e911": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "id",
            "type": "uint64"
          }
        ],
        "name": "agentRecovered",
        "type": "event"
      },
      "0xf8a972487b9e0fe9a7dd9e51da864d5f79ddacb7ee8b820f9934383059b0c88b": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          }
        ],
        "name": "agentMoved",
        "type": "event"
      },
      "0x5a6e5ec3bf040ed041d47a7b57dbb50b489a1c7335df9cb405bd97d610e8916e": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "currentTime",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infectedAgents",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "totalAgents",
            "type": "uint64"
          }
        ],
        "name": "simulationStep",
        "type": "event"
      },
      "0xee4d43072717ac1a93988c369bc2e5ecc85a8214bc29e77c32b373ae5b452b58": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "times",
            "type": "uint64"
          }
        ],
        "name": "movementDataRecord",
        "type": "event"
      }
    },
    "updated_at": 1483931367504,
    "links": {},
    "address": "0x203028e846f512ef3320c10f0d39739906e65797"
  },
  "default": {
    "abi": [
      {
        "constant": true,
        "inputs": [],
        "name": "getInfectedAgentCount",
        "outputs": [
          {
            "name": "count",
            "type": "uint64"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [],
        "name": "tick",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getAgentCount",
        "outputs": [
          {
            "name": "count",
            "type": "uint64"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "agentId",
            "type": "uint256"
          },
          {
            "name": "fromLocation",
            "type": "uint256"
          },
          {
            "name": "toLocation",
            "type": "uint256"
          },
          {
            "name": "times",
            "type": "uint256"
          }
        ],
        "name": "observeMovement",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "initialLocation",
            "type": "uint256"
          },
          {
            "name": "contacts",
            "type": "uint256"
          },
          {
            "name": "name",
            "type": "string"
          }
        ],
        "name": "addAgent",
        "outputs": [],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getElapsedSimulatedTime",
        "outputs": [
          {
            "name": "time",
            "type": "uint64"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "betaN",
            "type": "uint256"
          },
          {
            "name": "betaD",
            "type": "uint256"
          },
          {
            "name": "locs",
            "type": "uint256"
          },
          {
            "name": "tStep",
            "type": "uint256"
          },
          {
            "name": "seed",
            "type": "uint256"
          },
          {
            "name": "cases",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "betaN",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "betaD",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "locs",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "tStep",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "seed",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "cases",
            "type": "uint64"
          }
        ],
        "name": "modelCreated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "id",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "initialLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "contacts",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "state",
            "type": "bytes1"
          }
        ],
        "name": "agentAdded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infector",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "susceptible",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infectiousPeriod",
            "type": "uint64"
          }
        ],
        "name": "agentInfected",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "id",
            "type": "uint64"
          }
        ],
        "name": "agentRecovered",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          }
        ],
        "name": "agentMoved",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "currentTime",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infectedAgents",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "totalAgents",
            "type": "uint64"
          }
        ],
        "name": "simulationStep",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "times",
            "type": "uint64"
          }
        ],
        "name": "movementDataRecord",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060405234620000005760405160c080620019c983398101604090815281516020830151918301516060840151608085015160a090950151929491929091905b60028054600380546001604060020a0319166001604060020a0389811691909117909155600160c060020a0390911678010000000000000000000000000000000000000000000000008983160217604060020a608060020a031916680100000000000000009186169190910217608060020a60c060020a031916905560008215620000e657600280546001604060020a0319166001604060020a03851617905562000101565b600280546001604060020a03191667e2d3c4b6a7f098511790555b50600380546001604060020a03868116780100000000000000000000000000000000000000000000000002911617905560015b6003546001604060020a0378010000000000000000000000000000000000000000000000009091048116908216116200019a576001604060020a038116600081815260016020526040902080546001604060020a03191690911790555b60010162000134565b50600480546001608060020a0319166001604060020a03831617905560005b6040816001604060020a03161015620001ef57620001e46401000000006200144f620002a182021704565b505b600101620001b9565b60048054700100000000000000000000000000000000608060020a60c060020a03199091168181046001604060020a03908116600181018216909302909117909255604080519182528983166020830152888316828201528783166060830152868316608083015285831660a083015291841660c082015290517ffc55679493421f362a8016519d44ecbd64447fb827ec54dd1a56121f8e2b9e0f9181900360e00190a15b5050505050505062000312565b600280546001604060020a03808216839004166001604060020a0319821617909155600090600190811690811415620002ff57600280546001604060020a031981166001604060020a0391821667d800000000000000189091161790555b6002546001604060020a031691505b5090565b6116a780620003226000396000f3006060604052361561005c5763ffffffff60e060020a600035041663017b328581146100615780633eaf5d9f1461008a57806391cab63e1461009957806395e71ad4146100c2578063a1b27aa4146100dd578063b5e3968d14610136575b610000565b346100005761006e61015f565b604080516001604060020a039092168252519081900360200190f35b3461000057610097610176565b005b346100005761006e6102bf565b604080516001604060020a039092168252519081900360200190f35b34610000576100976004356024356044356064356102d6565b005b3461000057604080516020600460443581810135601f810184900484028501840190955284845261009794823594602480359560649492939190920191819084018382808284375094965061043a95505050505050565b005b346100005761006e610a84565b604080516001604060020a039092168252519081900360200190f35b600354608060020a90046001604060020a03165b90565b60008060015b6003546001604060020a03604060020a9091048116908216116101e8576101a281610a9b565b7effffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff191660f860020a60490214156101d9576001909201915b6001909101905b60010161017c565b5060015b6003546001604060020a03604060020a90910481169082161161021b5761021281610c2e565b5b6001016101ec565b60028054608060020a8082046001604060020a03908116604060020a840482160181168202608060020a60c060020a0319938416179384905560048054838104831660018101841685029190951617905560408051938452919093048316602083015285831682820152918416606082015290517f5a6e5ec3bf040ed041d47a7b57dbb50b489a1c7335df9cb405bd97d610e8916e9181900360800190a15b505050565b600354604060020a90046001604060020a03165b90565b6001604060020a0380851660009081526020818152604080832087851684526004019091529020805483928516908110156100005790600052602060002090600491828204019190066008025b81546101009190910a6001604060020a038181021983169282900481169490940184160217905584811660009081526020818152604080832093871683526004909301905290812080548392908110156100005790600052602060002090600491828204019190066008025b81546101009190910a6001604060020a038181021983169282900481169490940184160217905560048054608060020a60c060020a03198116608060020a91829004841660018101851690920217909155604080519182528683166020830152858316828201528483166060830152918316608082015290517fee4d43072717ac1a93988c369bc2e5ecc85a8214bc29e77c32b373ae5b452b589160a0908290030190a15b50505050565b600380546fffffffffffffffff000000000000000019808216604060020a928390046001604060020a03908116600190810180831680870294909417909655600083815260208181526040808320805468ffffffffffffffff001916610100909702969096178655948301805467ffffffffffffffff19168b8616179096168b8516880217958690559590940490911683529283905281208201805492830180825591929091828183801582901161052757600301600490048160030160049004836000526020600020918201910161052791905b80821115610523576000815560010161050f565b5090565b5b50505091600052602060002090600491828204019190066008025b81546001604060020a0380871661010093840a81810292021990921617909255600091825260208281526040832060018181018054608060020a60c060020a03191690556002808301805473ffffffffffffffffffffffffffffffffffffffff331673ffffffffffffffffffffffffffffffffffffffff1990911617905589516003909301805481885296859020909750601f928716159095026000190190951694909404840182900483019390929188019083901061060e57805160ff191683800117855561063b565b8280016001018555821561063b579182015b8281111561063b578251825591602001919060010190610620565b5b5061065c9291505b80821115610523576000815560010161050f565b5090565b50506004546001604060020a03808216604060020a90920416101561075657600480546fffffffffffffffff0000000000000000198116604060020a918290046001604060020a03908116600190810182169093029190911790925560038054608060020a60c060020a03198116608060020a91829004851690930184160291909117905582166000908152602081905260409020805460ff1916604917905561070c620173186206baa86110a5565b6001604060020a038381166000908152602081905260409020805470ffffffffffffffff00000000000000000019166901000000000000000000939092169290920217905561078e565b6001604060020a0382166000908152602081905260409020805460ff191660531770ffffffffffffffff000000000000000000191690555b506001604060020a03811660009081526020819052604090208054608860020a67ffffffffffffffff021916905560015b6003546001604060020a0360c060020a90910481169082161161092957600360189054906101000a90046001604060020a03166001016001604060020a031660405180591061080b5750595b908082528060200260200182016040525b506001604060020a038084166000908152602081815260408083209386168352600493840182528220845181548183558285529383902091956003909401949094048101939290910182156108f35791602002820160005b838211156108be57835183826101000a8154816001604060020a0302191690836001604060020a031602179055509260200192600801602081600701049283019260010302610874565b80156108f15782816101000a8154906001604060020a0302191690556008016020816007010492830192600103026108be565b505b5061091e9291505b8082111561052357805467ffffffffffffffff191681556001016108fb565b5090565b50505b6001016107bf565b6004805460016001604060020a03608060020a80840482168381018316909102608060020a60c060020a0319909416939093179093558483166000908152602081815260409182902080548185015484518781526101008084048a16958201869052604060020a83048a169682018790529190981660608901819052600160f860020a031960f860020a90930292831660a08a015260c060808a018181526003909501805460026000199a82161590950299909901909816929092049189018290527f37bac8e66dacf996f814135957cf16d22b8897281288666a7bb86d5eb9dcf2cb98949690949093909160e083019085908015610a695780601f10610a3e57610100808354040283529160200191610a69565b820191906000526020600020905b815481529060010190602001808311610a4c57829003601f168201915b505097505050505050505060405180910390a15b5050505050565b600254608060020a90046001604060020a03165b90565b6001604060020a03811660009081526020819052604081205460f860020a02600160f860020a03191660f860020a6049021415610bfd576002546001604060020a0383811660009081526020819052604090208054710100000000000000000000000000000000008082048416604060020a90950484169490940183168402608860020a67ffffffffffffffff02199091161790819055690100000000000000000081048216929004161115610bf4576001604060020a0382811660008181526020818152604091829020805460ff1916605217905560038054608060020a60c060020a0319808216608060020a9283900488166000190188168302179092556004805492831692829004871660018101909716909102919091179055815193845283019190915280517f445a4b6c3a89b88766d988d26ca839acfd3007f9ebf52b7f98e5bca76af8e9119281900390910190a1610bfd565b610bfd826110f1565b5b5b610c08826111f0565b506001604060020a03811660009081526020819052604090205460f860020a025b919050565b6001604060020a03808216600090815260208190526040812060010154604060020a9004909116905b6001604060020a0380831660009081526001602081905260409091200154908216108015610ce357506001604060020a038281166000908152600160208190526040909120018054828616928416908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a03166001604060020a031614155b15610cf057600101610c57565b6001604060020a03808316600090815260016020819052604090912001549082161015610e7a576001604060020a03821660009081526001602081905260409091208101541115610e06576001604060020a03821660009081526001602081905260409091200180546000198101908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a031660016000846001604060020a03166001604060020a03168152602001908152602001600020600101826001604060020a031681548110156100005790600052602060002090600491828204019190066008025b6101000a8154816001604060020a0302191690836001604060020a031602179055505b6001604060020a03821660009081526001602081905260409091200180546000198101808355919082908015829011610e74576003016004900481600301600490048360005260206000209182019101610e7491905b80821115610523576000815560010161050f565b5090565b5b505050505b6001604060020a03808416600090815260208190526040902060010154608060020a9004161515610f1d5760016000610ecc6001600360189054906101000a90046001604060020a03166001016110a5565b6001604060020a0390811682526020808301939093526040918201600090812054878316825293819052919091206001018054608060020a60c060020a03191692909116608060020a029190911790555b6001604060020a0380841660009081526020818152604080832060019081018054604060020a608060020a8204881681026fffffffffffffffff000000000000000019909216919091179182905590049094168352908390529020810180549182018082559091908281838015829011610fcc576003016004900481600301600490048360005260206000209182019101610fcc91905b80821115610523576000815560010161050f565b5090565b5b50505091600052602060002090600491828204019190066008025b81546001604060020a038088166101009390930a838102908202199092169190911790925560048054608060020a808204851660018181018716909202608060020a60c060020a031990931692909217909255600083815260208181526040918290209093015481519283529282019390935286841681840152604060020a9091049092166060830152517ff8a972487b9e0fe9a7dd9e51da864d5f79ddacb7ee8b820f9934383059b0c88b92509081900360800190a15b505050565b600060028383036001604060020a031610156110c25750816110eb565b8282036001604060020a03166110d661144f565b6001604060020a031681156100005706830190505b92915050565b6001604060020a03808216600090815260208181526040808320600190810154604060020a9004851684529182905282208101549282919084161115610434575060005b6001604060020a0380851660009081526020819052604090206001015416811215610434576111656000846110a5565b6001604060020a03808616600090815260208181526040808320600190810154604060020a9004851684529182905290912001805492945091908416908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a031691506111df84836114c1565b5b600101611135565b5b5b50505050565b6001604060020a038082166000908152602081815260408083206001810154604060020a900490941683526004909301905290812080548291829182919082908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a03166001604060020a031611156113d0576001604060020a03808516600090815260208181526040808320600181810154604060020a90049095168452600401909152812080546112e59392908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a03166001016110a5565b925060009150600090505b826001604060020a0316826001604060020a03161015611385576001604060020a03808516600090815260208181526040808320600181810154604060020a900486168552600490910190925290912080549190930192918316908110156100005790600052602060002090600491828204019190066008025b9054906101000a90046001604060020a0316820191506112f0565b6001604060020a03818116600090815260016020818152604080842054898616855291849052909220018054608060020a60c060020a03191691909216608060020a02179055610434565b600160006113f76001600360189054906101000a90046001604060020a03166001016110a5565b6001604060020a0390811682526020808301939093526040918201600090812054888316825293819052919091206001018054608060020a60c060020a03191692909116608060020a029190911790555b5b50505050565b600280546001604060020a038082168390041667ffffffffffffffff198216179091556000906001908116908114156114ae576002805467ffffffffffffffff1981166001604060020a0391821667d800000000000000189091161790555b6002546001604060020a031691505b5090565b6001604060020a03811660009081526020819052604090205460f860020a02600160f860020a0319167f53000000000000000000000000000000000000000000000000000000000000001415611675576002546003546001604060020a0360c060020a90920482169161153791600091166110a5565b6001604060020a03161015611675576001604060020a038181166000908152602081905260409020805460ff1916604917608860020a67ffffffffffffffff021916905560038054608060020a60c060020a03198116608060020a918290048416600101909316029190911790556115b5620173186206baa86110a5565b6001604060020a0382811660008181526020818152604091829020805470ffffffffffffffff00000000000000000019166901000000000000000000968616870217815560048054608060020a60c060020a03198116608060020a9182900488166001810189169092021790915590548351918252888616928201929092528083019390935293909304909116606082015290517f4c0942992c4c10c70bdd9f06b65ea73d723904bdd14b81fc59b3ac1b5717d1d8916080908290030190a15b5b5b50505600a165627a7a72305820b5c17c5ff2099291373bd574101e6b029da5db8457896598dc581c3257210cec0029",
    "events": {
      "0x235f4f7e3c388967476b5a7ee38caee7283539c1f7ffc73bf921c43a8e1538d1": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "betaN",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "betaD",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "locs",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "tStep",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "seed",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "cases",
            "type": "uint64"
          }
        ],
        "name": "modelCreated",
        "type": "event"
      },
      "0x9d5b12ecdffb7b3d0abb7d56ccf3b29608c8b6d1278c80057b8e236bbc0a19e3": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "id",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "initialLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "contacts",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "state",
            "type": "bytes1"
          }
        ],
        "name": "agentAdded",
        "type": "event"
      },
      "0x6f896eb22556e0bb163521ea30f64905a1453a30ae57fed5178e11a362fe5226": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "infector",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "susceptible",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infectiousPeriod",
            "type": "uint64"
          }
        ],
        "name": "agentInfected",
        "type": "event"
      },
      "0x9212b68c53c93104e852a3eb62451f9c754698701a79cb0ca015bb2eed381761": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "id",
            "type": "uint64"
          }
        ],
        "name": "agentRecovered",
        "type": "event"
      },
      "0x658493f885f5d87716e82ce2fa498ed1ed274b2cf6a5d1ba56d18ebcdf2d0abd": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          }
        ],
        "name": "agentMoved",
        "type": "event"
      },
      "0xfc82e545e0ed82d3953f9c22225c201fd6d3603297a29315ccde7a3f267f4b30": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "currentTime",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infectedAgents",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "totalAgents",
            "type": "uint64"
          }
        ],
        "name": "simulationStep",
        "type": "event"
      },
      "0xfed7abab6a6d26b1425eea363a6f34c1a806634fb77e67d5c6b5fde2a3d0b624": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          }
        ],
        "name": "movementDataRecord",
        "type": "event"
      },
      "0xe8f66eebfe2140951839da8c23fee2c8909e30c4e88ea8095d669488a6da7d51": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "times",
            "type": "uint64"
          }
        ],
        "name": "movementDataRecord",
        "type": "event"
      },
      "0xfc55679493421f362a8016519d44ecbd64447fb827ec54dd1a56121f8e2b9e0f": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "betaN",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "betaD",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "locs",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "tStep",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "seed",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "cases",
            "type": "uint64"
          }
        ],
        "name": "modelCreated",
        "type": "event"
      },
      "0x37bac8e66dacf996f814135957cf16d22b8897281288666a7bb86d5eb9dcf2cb": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "id",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "initialLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "contacts",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "name",
            "type": "string"
          },
          {
            "indexed": false,
            "name": "state",
            "type": "bytes1"
          }
        ],
        "name": "agentAdded",
        "type": "event"
      },
      "0x4c0942992c4c10c70bdd9f06b65ea73d723904bdd14b81fc59b3ac1b5717d1d8": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infector",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "susceptible",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infectiousPeriod",
            "type": "uint64"
          }
        ],
        "name": "agentInfected",
        "type": "event"
      },
      "0x445a4b6c3a89b88766d988d26ca839acfd3007f9ebf52b7f98e5bca76af8e911": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "id",
            "type": "uint64"
          }
        ],
        "name": "agentRecovered",
        "type": "event"
      },
      "0xf8a972487b9e0fe9a7dd9e51da864d5f79ddacb7ee8b820f9934383059b0c88b": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          }
        ],
        "name": "agentMoved",
        "type": "event"
      },
      "0x5a6e5ec3bf040ed041d47a7b57dbb50b489a1c7335df9cb405bd97d610e8916e": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "currentTime",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "infectedAgents",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "totalAgents",
            "type": "uint64"
          }
        ],
        "name": "simulationStep",
        "type": "event"
      },
      "0xee4d43072717ac1a93988c369bc2e5ecc85a8214bc29e77c32b373ae5b452b58": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "name": "order",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "agentID",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "oldLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "newLocation",
            "type": "uint64"
          },
          {
            "indexed": false,
            "name": "times",
            "type": "uint64"
          }
        ],
        "name": "movementDataRecord",
        "type": "event"
      }
    },
    "updated_at": 1483844918592,
    "links": {},
    "address": "0xb20ab177ff2b2ac2a9c079451f6e593ed50b0281"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "ABM";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.ABM = Contract;
  }
})();
