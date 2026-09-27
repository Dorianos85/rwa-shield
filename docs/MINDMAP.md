# RWA Shield — Project Mind Map

A one-page map of the project: problem, ECV engine, evidence, dashboard, devnet program, hackathons, monetization hypothesis, team and roadmap. Details and sources are in [WHITEPAPER.md](WHITEPAPER.md) and [ROADMAP.md](ROADMAP.md). All backtest figures are synthetic and in-sample; the on-chain program runs on Solana devnet.

```mermaid
mindmap
  root((RWA Shield))
    Problem
      Oracle price is not cash
      Thin books and closed NYSE sessions
      Fixed LTV ignores recoverable value
    ECV engine
      Price blend of spot and TWAP
      Depth and slippage for position size
      NYSE session factor
      Volatility haircut
      Breaker gates new credit only
      Five frozen outputs
        max_borrow
        collateral_cap
        liquidation_route
        risk_premium
        borrow_disabled
    Evidence
      Synthetic in-sample backtest
        Six stress scenarios
        Tail scenario 3.98M USD vs 0 USD bad debt
        369 refusals in tail scenario
      Yahoo SPY proxy series in PR 1
      Legacy breaker demo
    Kamino risk dashboard PR 3
      Recorded Kamino snapshot
      Jupiter quote ladder
      Stress sandbox
      Four stress axes
    Onchain devnet
      Anchor program ecv_oracle
      Publishes outputs, does not enforce
      Rust poster with every-sec mode
      Last record posted 26.09.2026
      SPYx mint fix in PR 4
    Hackathons
      Blockchain Hack Kraków 20.09.2026
      Stocklana by 25.09.2026
      Warsaw pitch 27.09.2026
      Colosseum deadline 12.10.2026
    Monetization hypothesis
      Risk API and SDK
      Share of risk premium
      Optional vault fees
    Team
      Dorian Żaczek, CEO, Founder and Product Manager
      Mieszko Manijak, CTO and DeFi Architect Engineer
      Julita Szaruta, Legal, Tax and Regulatory Lead
      Adam Książkiewicz, investiatech, Rust, devnet deploy, quant
      Adam Kwak, Advisor
    Roadmap
      Colosseum submission
      Vault and borrow gate
      Verifiable inputs and multi-signer
      Walk-forward backtest
      Mainnet only after external audit
```

Notes:
- Node text avoids brackets, parentheses and colons so the Mermaid parser stays simple.
- "Mainnet only after external audit" is an undated long-term goal, not the current status.
