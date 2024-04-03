import {
  Connection,
  PublicKey,
  AccountInfo,
  ProgramAccountChangeCallback
} from '@solana/web3.js';
import { getTokenAccounts, RAYDIUM_LIQUIDITY_PROGRAM_ID_V4, OPENBOOK_PROGRAM_ID, createPoolKeys } from './liquidity';
import {
  LIQUIDITY_STATE_LAYOUT_V4,
  LiquidityStateV4
} from '@raydium-io/raydium-sdk';
const fetch = require('node-fetch'); 
import { COMMITMENT_LEVEL, QUOTE_MINT, RPC_ENDPOINT, RPC_WEBSOCKET_ENDPOINT, DISCORD_WEBHOOK_URL } from './constants';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { Metaplex, PublicKeyString } from '@metaplex-foundation/js';
const bs58 = require('bs58');
const solanaConnection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT
});
// Use the RPC endpoint of your choice.
const umi = createUmi('https://solana-mainnet.g.alchemy.com/v2/pQ4gou7V8HxBNcV-NuXdGxaK0vzaDVzo')
let quoteToken: PublicKey;
type QueueElement = {
  mintAddress: string;
  resolve: (value: any) => void;
};

let rateLimitQueue: QueueElement[] = [];
let processingQueue = false;

function processQueue() {
  if (processingQueue || rateLimitQueue.length === 0) {
    return;
  }

  processingQueue = true;
  setTimeout(async () => {
    const queueElement = rateLimitQueue.shift();
    
    if (queueElement) {
      const { mintAddress, resolve } = queueElement;
      const tokenData = await actualFetchTokenData(mintAddress);
      resolve(tokenData);
    }

    processingQueue = false;
    processQueue();
  }, 1000 / 250); // Processing up to 250 requests per second
}

async function enqueueFetchTokenData(mintAddress: any) {
  return new Promise((resolve) => {
    rateLimitQueue.push({ mintAddress, resolve });
    processQueue();
  });
}

async function actualFetchTokenData(mintAddress: string) {
  const requestBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenAccountsByOwner",
    params: [
      mintAddress,
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, // Solana Token Program ID
      { encoding: "jsonParsed" } // Specifies the format of the returned data
    ]
  };

  try {
    const response = await fetch('https://solana-mainnet.g.alchemy.com/v2/pQ4gou7V8HxBNcV-NuXdGxaK0vzaDVzo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching token data:', error);
    return null;
  }
}

export async function getMetaData(mint_address: PublicKeyString) {
  const connection = new Connection('https://solana-mainnet.g.alchemy.com/v2/pQ4gou7V8HxBNcV-NuXdGxaK0vzaDVzo');
  const metaplex = Metaplex.make(connection);

  const mintAddress = new PublicKey(mint_address);

  let tokenName;
  let tokenSymbol;
  let tokenLogo;

  const metadataAccount = metaplex.nfts().pdas().metadata({ mint: mintAddress });

  const metadataAccountInfo = await connection.getAccountInfo(metadataAccount);

  if (metadataAccountInfo) {
    const token = await metaplex.nfts().findByMint({ mintAddress: mintAddress });
    tokenName = token.name;
    tokenSymbol = token.symbol;
    tokenLogo = token.json?.image;

    return { tokenName, tokenSymbol, tokenLogo };
  }
}

function initQuoteToken(): PublicKey {
  switch (QUOTE_MINT) {
    case 'WSOL':
      return new PublicKey('So11111111111111111111111111111111111111112');
    case 'USDC':
      return new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    default:
      throw new Error(`Unsupported quote mint "${QUOTE_MINT}". Supported values are USDC and WSOL`);
  }
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendDiscordMessage(content: object): Promise<void> {
  try {
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    } else {
      console.log('Discord message sent successfully');
      await delay(3500);
    }
  } catch (error) {
    console.error('Failed to send Discord message:', error);
  }
}

const existingLiquidityPools: Set<string> = new Set<string>(); 

const processLiquidityPool = async (accountInfo: AccountInfo<Buffer>, accountId: PublicKey) => {
  const key = accountId.toString();
  const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(accountInfo.data) as LiquidityStateV4;

  if (!existingLiquidityPools.has(key) && poolState.quoteMint.equals(quoteToken)) {
    existingLiquidityPools.add(key);
    console.log(`New liquidity pool detected: ${key}`);  
    const minW = poolState.baseMint.toBase58();
    const asset = await getMetaData(minW); 
    // console.log(asset); 
    // Fetch additional token data
    // const tokenData = await actualFetchTokenData(poolState.baseMint.toBase58()); 

    if(!asset){
      return
    }
    // const mintAddress = tokenData.result.value[0].account.data.parsed.info.mint;
    const linkValues = `[BirdEye](https://birdeye.so/token/${key}) | [DexScreener](https://dexscreener.com/solana/${key}) | [RugCheck](https://rugcheck.xyz/token/${key})`;
    // Construct the Discord message payload here
    const discordMessage = {
      embeds: [
        {
          title: asset?.tokenName, // Update as needed
          description: `Token symbol: $${asset?.tokenSymbol}`, // Update as needed
          color: 10181046,
          thumbnail: {
            url: asset?.tokenLogo // Update as needed
          },
          fields: [
            {
              name: 'Mint Address',
              value: key,
              inline: false
            },
            // {
            //   name: 'Owner',
            //   value: tokenData.result.value[0].account.data.parsed.info.owner,
            //   inline: false
            // },
            // {
            //   name: 'Token Amount',
            //   value: tokenData.result.value[0].account.data.parsed.info.tokenAmount.uiAmountString,
            //   inline: false
            // },   
            {
              name: 'Links',
              value: linkValues,
              inline: false
            }
          ],
          image: {
            url: 'attachment://pool-image.png'
          },
          footer: {
            text: 'Solana Pool Listing Bot'
          },
          timestamp: new Date().toISOString()
        }
      ]
    };
    
    await delay(3000);

    await sendDiscordMessage(discordMessage);
  }
};

const liquidityPoolListener: ProgramAccountChangeCallback = async (keyedAccountInfo ) => {
  const { accountId, accountInfo } = keyedAccountInfo;
  await processLiquidityPool(accountInfo, accountId);
};

const runListener = async () => {
  quoteToken = initQuoteToken();
  console.log('Listening for new liquidity pools on Raydium...');

  const raydiumSubscriptionId = solanaConnection.onProgramAccountChange(
    RAYDIUM_LIQUIDITY_PROGRAM_ID_V4, // Replace with actual Raydium liquidity program ID
    liquidityPoolListener,
    COMMITMENT_LEVEL,
    [
      { dataSize: LIQUIDITY_STATE_LAYOUT_V4.span },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('quoteMint'),
          bytes: quoteToken.toBase58()
        }
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('marketProgramId'),
          bytes: OPENBOOK_PROGRAM_ID.toBase58(),
        },
      },
      {
        memcmp: {
          offset: LIQUIDITY_STATE_LAYOUT_V4.offsetOf('status'),
          bytes: bs58.encode([6, 0, 0, 0, 0, 0, 0, 0]),
        },
      },
    ]
  );

  console.log(`Raydium subscription ID: ${raydiumSubscriptionId}`);
};

runListener();