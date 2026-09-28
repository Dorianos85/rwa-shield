// Generated from the API constants and synthetic backtest. No market quotes.
export const PRICES = { SPYx: 612.4, QQQx: 528.1, NVDAx: 184.9 };
export const MINTS = {"USDC":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","SPYx":"XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB","QQQx":"XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1","NVDAx":"Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"};
export const VOL = 0.12101685812141401;
export const BACKTEST = [
  {
    "id": "base",
    "label": "Rynek bazowy",
    "fixedBadDebt": 0,
    "ecvBadDebt": 0,
    "avoided": 0,
    "lentRatio": 0.8,
    "offHours": 36,
    "refusals": 0
  },
  {
    "id": "weekend_gap",
    "label": "Weekend gap -14% przy otwarciu",
    "fixedBadDebt": 10701,
    "ecvBadDebt": 0,
    "avoided": 10701,
    "lentRatio": 0.16,
    "offHours": 22,
    "refusals": 294
  },
  {
    "id": "weekend_tail",
    "label": "Ogon: gap -22% w weekend + cienka ksiega",
    "fixedBadDebt": 5336023,
    "ecvBadDebt": 0,
    "avoided": 5336023,
    "lentRatio": 0,
    "offHours": 0,
    "refusals": 369
  },
  {
    "id": "depth_collapse",
    "label": "Zapaść płynności (-70% głębokości)",
    "fixedBadDebt": 298705,
    "ecvBadDebt": 0,
    "avoided": 298705,
    "lentRatio": 0,
    "offHours": 0,
    "refusals": 369
  },
  {
    "id": "earnings_gap",
    "label": "Gap pojedynczej spolki -18% (earnings)",
    "fixedBadDebt": 72160,
    "ecvBadDebt": 0,
    "avoided": 72160,
    "lentRatio": 0.13,
    "offHours": 7,
    "refusals": 294
  },
  {
    "id": "vol_spike",
    "label": "Skok zmienności (earnings)",
    "fixedBadDebt": 0,
    "ecvBadDebt": 0,
    "avoided": 0,
    "lentRatio": 0.14,
    "offHours": 0,
    "refusals": 294
  }
];
