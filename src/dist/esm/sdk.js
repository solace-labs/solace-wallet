import * as anchor from "./anchor";
import { findProgramAddressSync } from "./anchor/dist/cjs/utils/pubkey";
import { BN } from "bn.js";
import IDL from "./solace/idl.json";
import bs58 from "bs58";
import { AccountLayout, TOKEN_PROGRAM_ID } from "@solana/spl-token";
export const PublicKey = anchor.web3.PublicKey;
export const KeyPair = anchor.web3.Keypair;
// The SDK to interface with the client
export class SolaceSDK {
    /**
     * Create a wallet instance. Should be used in conjuncture with an initializer
     * @param {SolaceSDKData} data
     */
    constructor(data) {
        this.tokenAccounts = new Array();
        /**
         * Fetch the wallet data for the current wallet
         */
        this.fetchWalletData = () => {
            if (!this.wallet)
                throw "Wallet not found. Please initialize the SDK with one of the given initializers, before using";
            return SolaceSDK.fetchDataForWallet(this.wallet, this.program);
        };
        /** Helper to confirm transactions */
        this.confirmTx = (tx) => this.program.provider.connection.confirmTransaction(tx);
        const provider = new anchor.Provider(data.network == "local"
            ? SolaceSDK.localConnection
            : SolaceSDK.testnetConnection, new anchor.Wallet(data.owner), anchor.Provider.defaultOptions());
        anchor.setProvider(provider);
        this.provider = provider;
        const programId = new anchor.web3.PublicKey(data.programAddress);
        this.program = new anchor.Program(
        // @ts-ignore
        IDL, programId, provider);
        this.owner = data.owner;
    }
    /**
     * Get the associated token account for the current wallet instance
     */
    getTokenAccount(mint) {
        var _a;
        let tokenAccount = (_a = this.tokenAccounts.find((x) => x.mint.equals(mint))) === null || _a === void 0 ? void 0 : _a.tokenAccount;
        if (!tokenAccount) {
            [tokenAccount] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("wallet"), this.wallet.toBuffer(), mint.toBuffer()], this.program.programId);
            this.tokenAccounts.push({
                mint,
                tokenAccount,
            });
        }
        return tokenAccount;
    }
    /**
     * Get the token account info if available, otherwise return null
     * Caches token accounts for quicker access
     */
    async getTokenAccountInfo(mint) {
        const tokenAccount = this.getTokenAccount(mint);
        const info = await SolaceSDK.localConnection.getAccountInfo(tokenAccount);
        if (!info) {
            return null;
        }
        const data = Buffer.from(info.data);
        const accountInfo = AccountLayout.decode(data);
        return accountInfo;
    }
    async signTransaction(transaction, payer) {
        const x = await anchor.getProvider().connection.getLatestBlockhash();
        const tx = new anchor.web3.Transaction({
            ...x,
            feePayer: payer,
        });
        tx.add(transaction);
        tx.partialSign(this.owner);
        const signature = tx.signatures[1].signature;
        return {
            signature: bs58.encode(signature),
            publicKey: this.owner.publicKey.toString(),
            message: tx.compileMessage().serialize().toString("base64"),
            blockHash: {
                blockhash: x.blockhash,
                lastValidBlockHeight: x.lastValidBlockHeight,
            },
        };
    }
    /// Generate a new key pair
    static newKeyPair() {
        return anchor.web3.Keypair.generate();
    }
    static fromSeed(seed, data) {
        const sdk = new this({
            ...data,
        });
        sdk.seed = new anchor.web3.PublicKey(seed);
        return this;
    }
    static getWalletFromName(programAddress, name) {
        const [walletAddress, _] = findProgramAddressSync([Buffer.from("SOLACE"), Buffer.from(name, "utf8")], new anchor.web3.PublicKey(programAddress));
        return walletAddress;
    }
    /**
     *
     * @param {string} name UserName of the user, which was initialized while creating the wallet
     * @param {SolaceSDKData} data Wallet meta data
     * @returns {SolaceSDK} instance of the sdk
     * Should be used only on users who have already created wallets. Features will fail if the user
     * has not created a wallet under this name, but is trying to retrieve it
     */
    static async retrieveFromName(name, data) {
        const sdk = new this(data);
        sdk.wallet = SolaceSDK.getWalletFromName(data.programAddress, name);
        return sdk;
    }
    /**
     * @param data {RequestWalletInformationData} data required to init the program and fetch guardian info
     * Static helper method to get only the guardian information of a particular wallet, given the address of the wallet. This method is helpful to know if a particular guardian is guarding any addresses. The data obtained by this function is on-chain and un-modifiable without program calls
     *
     */
    static async getWalletGuardianInfo(data) {
        const provider = new anchor.Provider(data.network == "local"
            ? SolaceSDK.localConnection
            : SolaceSDK.testnetConnection, new anchor.Wallet(KeyPair.generate()), anchor.Provider.defaultOptions());
        const programId = new anchor.web3.PublicKey(data.programAddress);
        const program = new anchor.Program(
        // @ts-ignore
        IDL, programId, provider);
        const wallet = await program.account.wallet.fetch(new PublicKey(data.solaceWalletAddress));
        if (!wallet) {
            throw "Invalid solace wallet address. The SDK could not find a Solace wallet with the given address, on the selected connection cluster";
        }
        return {
            pendingGuardians: wallet.pendingGuardians,
            approvedGuardians: wallet.approvedGuardians,
        };
    }
    /**
     * Create a wallet for the first time
     * @param {string} name Name of the user
     * @returns {Promise<RelayerIxData>} return the transaction that can be relayed
     */
    async createFromName(name, feePayer) {
        const [walletAddress, _] = findProgramAddressSync([Buffer.from("SOLACE"), Buffer.from(name, "utf8")], this.program.programId);
        console.log("Owner Address", this.owner.publicKey.toString());
        const tx = this.program.transaction.createWallet(this.owner.publicKey, // Owner
        [], // Guardian
        0, // Guardian Approval Threshold
        name, {
            accounts: {
                signer: this.owner.publicKey,
                rentPayer: feePayer,
                wallet: walletAddress,
                systemProgram: anchor.web3.SystemProgram.programId,
            },
        });
        this.wallet = walletAddress;
        return this.signTransaction(tx, feePayer);
    }
    /**
     * Should send some amount of SOL to the `toAddress`
     */
    async sendSol(toAddress, lamports, feePayer) {
        const tx = this.program.transaction.sendSol(new anchor.BN(lamports), {
            accounts: {
                toAccount: toAddress,
                wallet: this.wallet,
                owner: this.owner.publicKey,
            },
            signers: [this.owner],
        });
        return this.signTransaction(tx, feePayer);
    }
    /**
     * Add a guardian to the wallet, signed by the owner
     * @param {anchor.web3.PublicKey} guardianPublicKey
     */
    async addGuardian(guardianPublicKey, payer) {
        const walletData = await this.fetchWalletData();
        const tx = this.program.transaction.addGuardians(guardianPublicKey, walletData.approvedGuardians.length + 1, {
            accounts: {
                wallet: this.wallet,
                owner: this.owner.publicKey,
            },
            signers: [this.owner],
        });
        return await this.signTransaction(tx, payer);
    }
    /**
     * Use this method to create a transaction which can be signed by the guardian, to approve guardianship to a specific wallet
     * @param data {ApproveGuardianshipData} data required to create a approve guardianship transaction
     */
    static approveGuardianshipTx(data) {
        const provider = new anchor.Provider(data.network == "local"
            ? SolaceSDK.localConnection
            : SolaceSDK.testnetConnection, new anchor.Wallet(KeyPair.generate()), anchor.Provider.defaultOptions());
        const programId = new anchor.web3.PublicKey(data.programAddress);
        const program = new anchor.Program(
        // @ts-ignore
        IDL, programId, provider);
        return program.transaction.approveGuardianship({
            accounts: {
                wallet: new PublicKey(data.solaceWalletAddress),
                guardian: new PublicKey(data.guardianAddress),
            },
        });
        // In this case, the owner is assumed to be the guardian
    }
    /**
     * FOR - User to remove a guardian
     */
    async removeGuardian(guardianAdress, payer) {
        const tx = this.program.transaction.removeGuardians({
            accounts: {
                wallet: this.wallet,
                guardian: guardianAdress,
                owner: this.owner.publicKey,
            },
            signers: [this.owner],
        });
        return await this.signTransaction(tx, payer);
    }
    /**
     * Checks if the given wallet address is in recovery mode
     * @param wallet The wallet to be checked
     * @returns
     */
    async isInRecovery(wallet) {
        return (await SolaceSDK.fetchDataForWallet(wallet, this.program))
            .recoveryMode;
    }
    /**
     * Approve recovery with a solace wallet
     * @param data
     * @param guardianAddress
     * @returns
     */
    static async approveRecoveryByKeypairTx(data, guardianAddress) {
        const provider = new anchor.Provider(data.network == "local"
            ? SolaceSDK.localConnection
            : SolaceSDK.testnetConnection, new anchor.Wallet(KeyPair.generate()), anchor.Provider.defaultOptions());
        const programId = new anchor.web3.PublicKey(data.programAddress);
        const program = new anchor.Program(
        // @ts-ignore
        IDL, programId, provider);
        const walletToRecover = SolaceSDK.getWalletFromName(data.programAddress, data.username);
        try {
            const walletData = await SolaceSDK.fetchDataForWallet(walletToRecover, program);
            const [recoveryAddress, _] = findProgramAddressSync([
                walletToRecover.toBuffer(),
                new BN(walletData.walletRecoverySequence).toBuffer("le", 8),
            ], program.programId);
            const tx = program.transaction.approveRecoveryByKeypair({
                accounts: {
                    walletToRecover: walletToRecover,
                    guardian: new anchor.web3.PublicKey(guardianAddress),
                    recoveryAttempt: recoveryAddress,
                },
            });
            return {
                tx,
                recoveryAddress,
            };
        }
        catch (e) {
            throw e;
        }
    }
    /**
     * Create an account, just to recover an existing one
     * @param data
     * @param feePayer
     */
    async recoverWallet(username, feePayer) {
        const addressToRecover = SolaceSDK.getWalletFromName(this.program.programId.toString(), username);
        this.wallet = addressToRecover;
        const walletData = await SolaceSDK.fetchDataForWallet(addressToRecover, this.program);
        if (!walletData) {
            throw "Invalid solace wallet address";
        }
        const [recoveryAddress, _] = findProgramAddressSync([
            addressToRecover.toBuffer(),
            new BN(walletData.walletRecoverySequence).toBuffer("le", 8),
        ], this.program.programId);
        const tx = this.program.transaction.initiateWalletRecovery(this.owner.publicKey, {
            accounts: {
                wallet: addressToRecover,
                recovery: recoveryAddress,
                proposer: this.owner.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
            },
        });
        return this.signTransaction(tx, feePayer);
    }
    /**
     * Check if a token account is valid. Should use try-catch around this method to check for the same.
     * If an error is caught, then the token account for the PDA doesn't exist and one needs to be created
     */
    checkTokenAccount(data, feePayer) {
        const tx = this.program.transaction.checkAta({
            accounts: {
                rentPayer: feePayer,
                wallet: this.wallet,
                tokenAccount: data.tokenAccount,
                tokenMint: data.tokenMint,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
                owner: this.owner.publicKey,
            },
            signers: [this.owner],
        });
        return this.signTransaction(tx, feePayer);
    }
    /**
     * Create a token account for a given mint. Only create if it doesn't already exists
     */
    createTokenAccount(data, feePayer) {
        const tx = this.program.transaction.createAta({
            accounts: {
                rentPayer: feePayer,
                owner: this.owner.publicKey,
                wallet: this.wallet,
                tokenMint: data.tokenMint,
                tokenAccount: data.tokenAccount,
                tokenProgram: TOKEN_PROGRAM_ID,
                rent: anchor.web3.SYSVAR_RENT_PUBKEY,
                systemProgram: anchor.web3.SystemProgram.programId,
            },
        });
        return this.signTransaction(tx, feePayer);
    }
    sendSplToken(data, feePayer) {
        const tx = this.program.transaction.sendSpl(new BN(data.amount), {
            accounts: {
                owner: this.owner.publicKey,
                wallet: this.wallet,
                recieverAccount: data.recieverTokenAccount,
                // reciever: data.reciever,
                tokenMint: data.mint,
                tokenAccount: this.getTokenAccount(data.mint),
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: anchor.web3.SystemProgram.programId,
            },
        });
        return this.signTransaction(tx, feePayer);
    }
}
SolaceSDK.localConnection = new anchor.web3.Connection("http://127.0.0.1:8899");
SolaceSDK.testnetConnection = new anchor.web3.Connection("https://api.testnet.solana.com");
/**
 * Fetch the state of any other given wallet
 */
SolaceSDK.fetchDataForWallet = (wallet, program) => program.account.wallet.fetch(wallet);
