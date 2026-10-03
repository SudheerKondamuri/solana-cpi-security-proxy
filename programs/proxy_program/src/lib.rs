use anchor_lang::prelude::*;

declare_id!("2em2HY5wgQa1tSz5xQbExEUDNWWBA52KGVzEWNH7oXD7");

/// The expected Target Program ID. The proxy will reject any CPI target
/// that does not match this address.
pub const TARGET_PROGRAM_ID: Pubkey =
    pubkey!("C8dbWuj9rvbUhR4v6Gkh3va8tpQrYvcp7qgE6shYzAoQ");

/// Custom error codes for the Proxy Program.
/// All validation failures return explicit errors — no panics, no silent passes.
#[error_code]
pub enum ProxyError {
    /// The target program passed in remaining_accounts[0] does not match
    /// the authorized Target Program ID.
    #[msg("Invalid target program: expected the authorized Target Program ID")]
    InvalidTargetProgram,

    /// The vault account passed in remaining_accounts[1] is not owned by
    /// the authorized Target Program.
    #[msg("Invalid vault owner: vault account is not owned by the Target Program")]
    InvalidVaultOwner,

    /// Not enough accounts were provided in remaining_accounts.
    /// At least 2 are required: [target_program, vault].
    #[msg("Insufficient remaining accounts: expected at least 2")]
    InsufficientAccounts,
}

#[program]
pub mod proxy_program {
    use super::*;

    /// Initializes the proxy state, deriving the PDA that will serve as the
    /// authority signer for CPI calls into the Target Program.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let proxy_state = &mut ctx.accounts.proxy_state;
        proxy_state.admin = ctx.accounts.admin.key();
        proxy_state.bump = ctx.bumps.proxy_state;
        msg!("Proxy initialized. PDA bump: {}", proxy_state.bump);
        Ok(())
    }

    /// Executes a CPI into the Target Program's update_vault instruction.
    ///
    /// The target program and vault accounts are passed dynamically via
    /// ctx.remaining_accounts to demonstrate manual account validation.
    ///
    /// Security checks (all fail-closed with custom errors):
    /// 1. remaining_accounts has at least 2 entries
    /// 2. remaining_accounts[0].key() == TARGET_PROGRAM_ID
    /// 3. remaining_accounts[1].owner == TARGET_PROGRAM_ID
    /// 4. CPI is signed with PDA signer seeds
    pub fn proxy_update<'info>(
        ctx: Context<'_, '_, '_, 'info, ProxyUpdate<'info>>,
        new_value: u64,
    ) -> Result<()> {
        // --- Validation: Extract and verify remaining_accounts ---

        // Check: Sufficient accounts provided
        require!(
            ctx.remaining_accounts.len() >= 2,
            ProxyError::InsufficientAccounts
        );

        let target_program_info = &ctx.remaining_accounts[0];
        let vault_info = &ctx.remaining_accounts[1];

        // Check 1: Verify the target program is the authorized Target Program
        require_keys_eq!(
            target_program_info.key(),
            TARGET_PROGRAM_ID,
            ProxyError::InvalidTargetProgram
        );

        // Check 2: Verify the vault account is owned by the Target Program
        require_keys_eq!(
            *vault_info.owner,
            TARGET_PROGRAM_ID,
            ProxyError::InvalidVaultOwner
        );

        // --- Construct and execute the CPI ---

        // Build the accounts for target_program::cpi::update_vault
        let cpi_accounts = target_program::cpi::accounts::UpdateVault {
            vault: vault_info.clone(),
            authority: ctx.accounts.proxy_signer.to_account_info(),
        };

        // PDA signer seeds: ["proxy_auth", bump] using the proxy_signer PDA bump
        let bump = ctx.bumps.proxy_signer;
        let seeds: &[&[u8]] = &[b"proxy_auth", &[bump]];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            target_program_info.clone(),
            cpi_accounts,
            signer_seeds,
        );

        // Execute the CPI
        target_program::cpi::update_vault(cpi_ctx, new_value)?;

        msg!("Proxy CPI successful: vault updated to {}", new_value);
        Ok(())
    }
}

/// Accounts for initializing the Proxy state.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + ProxyState::INIT_SPACE,
        seeds = [b"proxy_state"],
        bump,
    )]
    pub proxy_state: Account<'info, ProxyState>,

    /// The PDA that will act as the authority/signer for CPI calls.
    /// CHECK: This is a PDA derived from known seeds; it is not read or written.
    #[account(
        seeds = [b"proxy_auth"],
        bump,
    )]
    pub proxy_signer: UncheckedAccount<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Accounts for proxy_update. Note: target program and vault are NOT declared
/// here — they come from remaining_accounts to demonstrate manual validation.
#[derive(Accounts)]
pub struct ProxyUpdate<'info> {
    #[account(
        seeds = [b"proxy_state"],
        bump = proxy_state.bump,
    )]
    pub proxy_state: Account<'info, ProxyState>,

    /// The PDA signer — used in CpiContext::new_with_signer.
    /// CHECK: Validated by seeds constraint.
    #[account(
        seeds = [b"proxy_auth"],
        bump,
    )]
    pub proxy_signer: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,
}

/// The proxy state account — stores admin and PDA bump.
#[account]
#[derive(InitSpace)]
pub struct ProxyState {
    pub admin: Pubkey,
    pub bump: u8,
}
