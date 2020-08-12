import { Account, EthereumProvider } from './types'

const KNOWN_CHAINS = new Map<number, string>([
  [1, 'Mainnet'],
  [3, 'Ropsten'],
  [4, 'Rinkeby'],
  [5, 'Goerli'],
  [100, 'xDai'],
  // This chainId is arbitrary and can be changed,
  // but by convention this is the number used
  // for local chains (ganache, buidler, etc) by default.
  [1337, 'Local'],
])

export function getNetworkName(chainId: number) {
  return KNOWN_CHAINS.get(chainId) || 'Unknown'
}

export function rpcResult(response: any): object | null {
  // Some providers don’t wrap the response
  if (typeof response === 'object' && 'jsonrpc' in response) {
    if (response.error) {
      throw new Error(response.error)
    }
    return response.result || null
  }
  return response || null
}

async function sendCompat(
  ethereum: EthereumProvider,
  method: string,
  params: string[]
): Promise<any> {
  // As of today (2020-02-17), MetaMask defines a send() method that correspond
  // to the one defined in EIP 1193. This is a breaking change since MetaMask
  // used to define a send() method that was an alias of the sendAsync()
  // method, and has a different signature than the send() defined by EIP 1193.
  // The latest version of Web3.js (1.2.6) is overwriting the ethereum.send()
  // provided by MetaMask, to replace it with ethereum.sendAsync(), making it
  // incompatible with EIP 1193 again.
  // This  means there is no way to detect that the ethereum.send() provided
  // corresponds to EIP 1193 or not. This is why we use sendAsync() when
  // available and send() otherwise, rather than the other way around.
  if (ethereum.sendAsync && ethereum.selectedAddress) {
    return new Promise((resolve, reject) => {
      ethereum.sendAsync(
        {
          method,
          params,
          from: ethereum.selectedAddress,
          jsonrpc: '2.0',
          id: 0,
        },
        (err: Error, result: any) => {
          if (err) {
            reject(err)
          } else {
            resolve(result)
          }
        }
      )
    }).then(rpcResult)
  }

  return ethereum.send(method, params).then(rpcResult)
}

export async function getAccountIsContract(
  ethereum: EthereumProvider,
  account: Account
): Promise<boolean> {
  try {
    const code = await sendCompat(ethereum, 'eth_getCode', [account])
    return code !== '0x'
  } catch (err) {
    return false
  }
}

export async function getAccountBalance(
  ethereum: EthereumProvider,
  account: Account
) {
  return sendCompat(ethereum, 'eth_getBalance', [account, 'latest'])
}

export async function getBlockNumber(ethereum: EthereumProvider) {
  return sendCompat(ethereum, 'eth_blockNumber', [])
}

export function pollEvery<R, T>(
  fn: (
    // As of TS 3.9, it doesn’t seem possible to specify dynamic params
    // as a generic type (e.g. using `T` here). Instead, we have to specify an
    // array in place (`T[]`), making it impossible to type params independently.
    ...params: T[]
  ) => {
    request: () => Promise<R>
    onResult: (result: R) => void
  },
  delay: number
) {
  let timer: any // can be TimeOut (Node) or number (web)
  let stop = false
  const poll = async (
    request: () => Promise<R>,
    onResult: (result: R) => void
  ) => {
    const result = await request()
    if (!stop) {
      onResult(result)
      timer = setTimeout(poll.bind(null, request, onResult), delay)
    }
  }
  return (...params: T[]) => {
    const { request, onResult } = fn(...params)
    stop = false
    poll(request, onResult)
    return () => {
      stop = true
      clearTimeout(timer)
    }
  }
}