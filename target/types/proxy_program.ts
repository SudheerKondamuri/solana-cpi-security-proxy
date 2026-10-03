/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/proxy_program.json`.
 */
export type ProxyProgram = {
  "address": "2em2HY5wgQa1tSz5xQbExEUDNWWBA52KGVzEWNH7oXD7",
  "metadata": {
    "name": "proxyProgram",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Proxy Program (Program A) - CPI Security Proxy with remaining_accounts validation"
  },
  "instructions": [
    {
      "name": "initialize",
      "docs": [
        "Initializes the proxy state, deriving the PDA that will serve as the",
        "authority signer for CPI calls into the Target Program."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "proxyState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  120,
                  121,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "proxySigner",
          "docs": [
            "The PDA that will act as the authority/signer for CPI calls."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  120,
                  121,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "proxyUpdate",
      "docs": [
        "Executes a CPI into the Target Program's update_vault instruction.",
        "",
        "The target program and vault accounts are passed dynamically via",
        "ctx.remaining_accounts to demonstrate manual account validation.",
        "",
        "Security checks (all fail-closed with custom errors):",
        "1. remaining_accounts has at least 2 entries",
        "2. remaining_accounts[0].key() == TARGET_PROGRAM_ID",
        "3. remaining_accounts[1].owner == TARGET_PROGRAM_ID",
        "4. CPI is signed with PDA signer seeds"
      ],
      "discriminator": [
        45,
        211,
        106,
        225,
        156,
        130,
        193,
        102
      ],
      "accounts": [
        {
          "name": "proxyState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  120,
                  121,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "proxySigner",
          "docs": [
            "The PDA signer — used in CpiContext::new_with_signer."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  120,
                  121,
                  95,
                  97,
                  117,
                  116,
                  104
                ]
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "newValue",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "proxyState",
      "discriminator": [
        251,
        85,
        254,
        21,
        255,
        249,
        155,
        204
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidTargetProgram",
      "msg": "Invalid target program: expected the authorized Target Program ID"
    },
    {
      "code": 6001,
      "name": "invalidVaultOwner",
      "msg": "Invalid vault owner: vault account is not owned by the Target Program"
    },
    {
      "code": 6002,
      "name": "insufficientAccounts",
      "msg": "Insufficient remaining accounts: expected at least 2"
    }
  ],
  "types": [
    {
      "name": "proxyState",
      "docs": [
        "The proxy state account — stores admin and PDA bump."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
