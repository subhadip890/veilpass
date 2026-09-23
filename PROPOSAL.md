# Product Proposal

## Selected Idea

**Age / Eligibility Gate**

## What is the product, and who uses it?

VeilPass is a privacy-preserving eligibility verification dApp built on the Midnight Network. It allows a user to prove that they satisfy a required age threshold, such as being at least 18 years old, without publishing their exact age, date of birth, identity document, or other unnecessary personal information on-chain.

The current application is designed for users who need to access age-restricted services and for platforms that need an eligibility result without collecting complete identity records. Possible users include online communities, digital marketplaces, entertainment platforms, restricted-content services, event organizers, and other applications that need to enforce an age or policy requirement.

A user connects a Midnight-compatible wallet on Preprod, enters their age as a private witness, and requests an eligibility proof. The Compact circuit evaluates the private value against the public policy threshold. If the requirement is satisfied, the transaction is submitted to Midnight Preprod and the confirmed eligibility result is displayed. If the supplied age is below the threshold, the circuit rejects the request locally and no eligibility transaction is submitted.

## Why Midnight specifically?

VeilPass requires Midnight because a conventional transparent blockchain would risk exposing sensitive personal information or permanently linking it to a public transaction. Publishing an exact age or date of birth would disclose more information than a service needs to determine eligibility.

Midnight enables VeilPass to separate private input from public verification. The user's exact age is provided as a private witness and evaluated during local zero-knowledge proof generation. The Compact circuit proves that the private value satisfies the required public threshold without placing the original value on the public ledger.

The public contract state contains only the minimum information needed to verify the policy outcome: the eligibility result, the threshold used, and the configured policy threshold. This selective-disclosure model allows a verifier to confirm that the rule was satisfied while preventing the user's exact age from being disclosed.

Midnight is therefore essential to the product rather than being used only as a transaction layer. Its private witnesses, Compact circuits, local proof generation, and verifiable public state form the core of VeilPass's privacy model.

## Data Model

| Data Point            | Type                        | Disclosed To                       |
| --------------------- | --------------------------- | ---------------------------------- |
| Policy threshold      | Public ledger state         | Everyone                           |
| Eligibility result    | Public ledger state         | Everyone                           |
| Threshold used        | Public ledger state         | Everyone                           |
| Contract address      | Public network data         | Everyone                           |
| Transaction ID        | Public transaction metadata | Everyone                           |
| Exact age             | Private witness             | Not disclosed to the public ledger |
| Proof-generation data | Local proving data          | User-controlled proof environment  |
| Wallet authorization  | Wallet session data         | User and wallet provider           |

The exact age exists only temporarily in the frontend and witness lifecycle while the circuit operation is being prepared and executed. The application does not intentionally store it in local storage, session storage, cookies, query parameters, application logs, or public contract state. The temporary value is cleared after the proof attempt finishes.

## Mainnet Feasibility

VeilPass already demonstrates the main technical flow on Midnight Preprod: wallet connection, private witness collection, local proof generation, Compact circuit execution, transaction submission, and confirmed ledger-state retrieval. The contract and frontend are supported by automated tests and a CI workflow that compiles, builds, tests, and lints the project on every push and pull request.

The current version uses a self-attested age entered by the user. It proves that the supplied private value satisfies the public threshold, but it does not prove that the value was issued or verified by a government authority or another trusted organization. This limitation is clearly communicated in the application.

A Mainnet-ready version could replace self-attestation with a verifiable credential issued by a trusted identity, education, employment, membership, or compliance provider. The user could then prove an eligibility property derived from that credential without revealing the complete credential or underlying personal data.

Future development can also support configurable policy thresholds, multiple eligibility policies, credential expiration, issuer validation, revocation checks, and reusable proofs for different services. These improvements build on the existing privacy architecture instead of requiring the product to be redesigned.

Reaching a Mainnet-capable prototype by Level 6 is realistic because the deployed contract, private circuit, wallet integration, proof flow, tests, CI pipeline, and production frontend already exist. The remaining work is primarily focused on strengthening the source of the private claim, expanding policy support, improving operational reliability, and completing security and usability reviews.

## Current Limitations

The current private age is self-attested by the user. VeilPass proves that this supplied value satisfies the contract's policy, but it cannot independently prove that the user entered a truthful age or that the value came from an official identity credential.

The current application demonstrates an age policy with a minimum threshold of 18. It is not yet a general credential-verification platform, although its architecture can be extended to support additional eligibility rules.

Proof generation currently requires access to a compatible local Midnight proof server. The user must also have a compatible Midnight wallet configured for the correct network.

VeilPass should therefore be treated as a functional privacy-preserving eligibility prototype on Midnight Preprod, with verifiable credentials and trusted attestation planned as future improvements for a production Mainnet release.
