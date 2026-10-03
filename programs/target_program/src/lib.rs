use anchor_lang::prelude::*;

declare_id!("C8dbWuj9rvbUhR4v6Gkh3va8tpQrYvcp7qgE6shYzAoQ");

#[program]
pub mod target_program {
    use super::*;

    /// Initializes a new vault account with zero value and sets the authority.
    /// The authority PDA (from the proxy program) will be the only account
    /// allowed to update the vault.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.value = 0;
        msg!("Vault initialized with authority: {}", vault.authority);
        Ok(())
    }

    /// Updates the vault value. Requires the authority to be a signer.
    /// This is the critical security boundary: only the Proxy PDA (which signed
    /// via CPI signer seeds) can call this successfully.
    pub fn update_vault(ctx: Context<UpdateVault>, new_value: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.value = new_value;
        msg!("Vault updated to value: {}", new_value);
        Ok(())
    }
}

/// Accounts for initializing the vault.
#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Vault::INIT_SPACE,
        seeds = [b"vault", authority.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// The authority that will control this vault (expected to be the Proxy PDA).
    /// CHECK: This is the authority pubkey stored in the vault. It can be any
    /// valid public key — validation happens at update time via signer checks.
    pub authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

/// Accounts for updating the vault. The authority MUST be a signer.
#[derive(Accounts)]
pub struct UpdateVault<'info> {
    #[account(
        mut,
        has_one = authority,
        seeds = [b"vault", authority.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// The authority that controls this vault. Must be a Signer — this is
    /// enforced by the Signer<'info> type. In CPI context, only a PDA
    /// with correct signer seeds can satisfy this.
    pub authority: Signer<'info>,
}

/// The vault state account.
#[account]
#[derive(InitSpace)]
pub struct Vault {
    /// The public key of the authority allowed to update this vault.
    pub authority: Pubkey,
    /// The stored value.
    pub value: u64,
}
