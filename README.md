# Intellichain
Intellichain - a blockchain enabled complex social systems decision support framework

ABM.sol implements an Agent Based Model for disease spread using the Solidty programming language.

If you have a running Ethereum client listening for RPC on port 8545 you should be able to just open up /build/index.html to interact with the deployed contract (if your account is unlocked and you have ETH). This might work with MetaMask as well.

To deploy your own ABM contract, make sure you have a running Ethereum client as above, clone the repo, and in the root project directory run:
truffle migrate --network main

Before running a simulation, make sure you add agents, and input movement patterns for each agent before starting. The first k agents added will be infected to begin with, where k is the number of initial infections specified when the contract was created.