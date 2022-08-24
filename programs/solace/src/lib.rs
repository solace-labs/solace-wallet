use anchor_lang::prelude::*;
use vipers::prelude::*;

mod errors;
mod state;
mod utils;
mod validators;

pub use errors::*;
pub use state::*;
pub use validators::*;

declare_id!("8FRYfiEcSPFuJd27jkKaPBwFCiXDFYrnfwqgH9JFjS2U");

#[program]
pub mod solace {

    use super::*;

    // Create the wallet for a owner
    // #[access_control(ctx.accounts.validate())]
    pub fn create_wallet(
        ctx: Context<CreateWallet>,
        owner: Pubkey,
        guardian_keys: Vec<Pubkey>,
        recovery_threshold: u8,
        name: String,
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        wallet.owner = owner;
        wallet.bump = *ctx.bumps.get("wallet").unwrap();
        wallet.name = name;
        wallet.approved_guardians = vec![];
        wallet.pending_guardians = guardian_keys;
        wallet.recovery_mode = false;
        wallet.recovery_threshold = recovery_threshold;
        wallet.wallet_recovery_sequence = 0;
        wallet.created_at = Clock::get().unwrap().unix_timestamp;
        Ok(())
    }

    // Add a token acount for a particular mint address. Ex. USDC
    pub fn add_token_account(_ctx: Context<NoAccount>) -> Result<()> {
        todo!();
        Ok(())
    }

    // Deposit SPL tokens for a given mint address
    pub fn deposit_spl_tokens(_ctx: Context<NoAccount>) -> Result<()> {
        todo!();
        Ok(())
    }

    // Deposit sol to the wallet. But why would anyone ever do that?
    pub fn deposit_sol(_ctx: Context<NoAccount>) -> Result<()> {
        Ok(())
    }

    // Send sol to a particular account
    pub fn send_sol(ctx: Context<SendSol>, amount_of_lamports: u64) -> Result<()> {
        let from_account = &mut ctx.accounts.wallet;
        // TODO: Check if the pda is in recovery mode and abort transaction if then

        assert!(!from_account.recovery_mode, "Payments are disabled");
        let to = ctx.accounts.to_account.to_account_info();
        let from = ctx.accounts.wallet.to_account_info();

        **from.try_borrow_mut_lamports()? -= amount_of_lamports;
        **to.try_borrow_mut_lamports()? += amount_of_lamports;

        Ok(())
    }

    /// Adds a guadian to the wallet's pending_guardians vector
    /// Access Control - Owner Only
    pub fn add_guardians(
        ctx: Context<AddGuardians>,
        guardians: Vec<Pubkey>,
        recovery_threshold: u8,
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        guardians.iter().for_each(|key| {
            wallet.pending_guardians.push(*key);
            ()
        });
        let now = Clock::get().unwrap().unix_timestamp;
        // Check if the wallet is in incubation mode
        if wallet.created_at < now * 12 * 36000 {
            // Approval can happen instantly
            wallet.pending_guardians_approval_from.push(now)
        } else {
            // Approval can happen only after 36 hours
            wallet
                .pending_guardians_approval_from
                .push(now + 36 * 36000)
        }
        // TODO: Handle recovery thresholds based on how many guardians are approved
        wallet.recovery_threshold = recovery_threshold;
        msg!("Added new pending guardians");
        Ok(())
    }

    /// Approve a guardian to the wallet
    /// Remove the given guardian from the pending guardians vec and add them to the approved guardian vec
    /// This requires the guardian to be a keypair guardian and not a solace-guardian
    /// Check for time-lock
    pub fn approve_guardianship(ctx: Context<ApproveGuardian>) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        let index = wallet
            .pending_guardians
            .iter()
            .position(|&x| x == ctx.accounts.guardian.key())
            .ok_or(errors::Errors::InvalidGuardian)
            .unwrap();

        let now = Clock::get().unwrap().unix_timestamp;

        let approval_time = wallet.pending_guardians_approval_from[index];
        // Ensure that the require amount of wait time has passed
        assert!(
            now > approval_time,
            "required wait-time has not yet been elapsed"
        );
        wallet.pending_guardians.remove(index);
        wallet.pending_guardians_approval_from.remove(index);
        wallet.approved_guardians.push(ctx.accounts.guardian.key());

        msg!("Guardian Approved");
        Ok(())
    }

    /// Remove guardian
    /// TODO: Add timelock to remove guardians
    pub fn remove_guardians(ctx: Context<RemoveGuardian>) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        let approved_guardians = wallet.approved_guardians.clone();
        let index = approved_guardians
            .iter()
            .position(|&x| x == ctx.accounts.guardian.key())
            .ok_or(errors::Errors::InvalidGuardian)
            .unwrap();
        wallet.approved_guardians.remove(index);
        msg!("Guardain removed");
        Ok(())
    }

    /// Initiate wallet recovery for an account
    pub fn initiate_wallet_recovery(
        ctx: Context<InitiateWalletRecovery>,
        new_owner: Pubkey,
    ) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet;
        let recovery = &mut ctx.accounts.recovery;

        recovery.wallet = wallet.key();
        recovery.new_owner = new_owner;
        recovery.proposer = ctx.accounts.proposer.key();
        recovery.bump = *ctx.bumps.get("recovery").unwrap();
        recovery.new_owner = ctx.accounts.proposer.key();
        recovery.approvals = vec![false; wallet.approved_guardians.len()];

        wallet.recovery_mode = true;
        wallet.current_recovery = Some(recovery.key());

        Ok(())
    }

    /// Approve the recovery attempt as a key pair guardian
    #[access_control(ctx.accounts.validate())]
    pub fn approve_recovery_by_keypair(ctx: Context<ApproveRecoveryByKeypair>) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet_to_recover;
        let recovery = &mut ctx.accounts.recovery_attempt;

        let index = utils::get_key_index::<Pubkey>(
            wallet.approved_guardians.clone(),
            ctx.accounts.guardian.key(),
        )
        .ok_or(Errors::InvalidGuardian)
        .unwrap();

        msg!("Guardian found at index {:?}", &index);

        recovery.approvals[index] = true;

        let can_update = utils::can_update_owner(&wallet, &recovery).unwrap();
        if can_update {
            wallet.recovery_mode = false;
            wallet.owner = recovery.new_owner;
            recovery.is_executed = true;
        }
        msg!("New owner set");
        Ok(())
    }

    /// Approve the recovery attempt as a Solace Guardian
    #[access_control(ctx.accounts.validate())]
    pub fn approve_recovery_by_solace(ctx: Context<ApproveRecoveryBySolace>) -> Result<()> {
        let wallet = &mut ctx.accounts.wallet_to_recover;
        let recovery = &mut ctx.accounts.recovery_attempt;

        let index = utils::get_key_index(
            wallet.approved_guardians.clone(),
            ctx.accounts.guardian_wallet.key(),
        )
        .ok_or(Errors::InvalidGuardian)
        .unwrap();

        recovery.approvals[index] = true;

        let can_update = utils::can_update_owner(&wallet, &recovery).unwrap();
        if can_update {
            wallet.recovery_mode = false;
            wallet.owner = recovery.new_owner;
            recovery.is_executed = true;
        }
        Ok(())
    }

    // Reject the recovery as a guardian for a wallet
    pub fn reject_recovery(_ctx: Context<NoAccount>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
pub struct NoAccount {}

// Access the name parameter passed to the txn
#[derive(Accounts)]
#[instruction(
    owner: Pubkey,
    guardian_keys: Vec<Pubkey>,
    recovery_threshold: u8,
    name: String,
)]
pub struct CreateWallet<'info> {
    #[account(mut)]
    signer: Signer<'info>,
    #[account(
        init,
        payer = signer,
        space = 1000,
        seeds = [b"SOLACE".as_ref(), name.as_str().as_ref()],
        bump
    )]
    wallet: Account<'info, Wallet>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddGuardians<'info> {
    #[account(mut, has_one = owner)]
    wallet: Account<'info, Wallet>,
    #[account(mut)]
    owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct ApproveGuardian<'info> {
    #[account(mut)]
    wallet: Account<'info, Wallet>,
    // The guardian who is approving the txn
    #[account(mut)]
    guardian: Signer<'info>,
}

#[derive(Accounts)]
pub struct RemoveGuardian<'info> {
    #[account(mut, has_one = owner)]
    wallet: Account<'info, Wallet>,
    /// CHECK: The guardian account to remove
    #[account()]
    guardian: AccountInfo<'info>,
    #[account(mut)]
    owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct SendSol<'info> {
    /// CHECK: The account to which sol needs to be sent to
    #[account(mut)]
    to_account: AccountInfo<'info>,

    #[account(mut, has_one = owner)]
    wallet: Account<'info, Wallet>,

    #[account(mut)]
    owner: Signer<'info>,
}

/// Initiate a wallet recovery for a particular Solace Wallet
/// This can be anyone signing for recover (Ideally the new wallet of the user)
#[derive(Accounts)]
pub struct InitiateWalletRecovery<'info> {
    #[account(mut)] // TODO: Add constraint to check guardian
    wallet: Account<'info, Wallet>,
    #[account(
        init,
        payer = proposer,
        space = 1000, // TODO: Add dynamic spacing
        seeds = [wallet.key().as_ref(), wallet.wallet_recovery_sequence.to_le_bytes().as_ref()],
        bump
    )]
    recovery: Account<'info, RecoveryAttempt>,
    #[account(mut)]
    proposer: Signer<'info>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApproveRecoveryByKeypair<'info> {
    #[account(mut)]
    wallet_to_recover: Account<'info, Wallet>,
    // The guardian approving the recovery - Must be a keypair guardian
    #[account(mut)]
    guardian: Signer<'info>,
    // The recovery account
    #[account(mut)]
    recovery_attempt: Account<'info, RecoveryAttempt>,
}

#[derive(Accounts)]
pub struct ApproveRecoveryBySolace<'info> {
    #[account(mut)]
    wallet_to_recover: Account<'info, Wallet>,
    // The guardian approving the recovery - Must be a keypair guardian
    #[account(mut)]
    owner: Signer<'info>,
    #[account(mut, has_one=owner)]
    guardian_wallet: Account<'info, Wallet>,
    // The recovery account
    #[account(mut)]
    recovery_attempt: Account<'info, RecoveryAttempt>,
}
