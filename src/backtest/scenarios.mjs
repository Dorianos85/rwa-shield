/** Stress scenarios. Each returns a transformed price series + depth factor. */

export const SCENARIOS = [
  {
    id: 'base',
    label: 'Rynek bazowy',
    transform: (s) => s,
    depthStressFactor: 1.0
  },
  {
    id: 'weekend_gap',
    label: 'Weekend gap -14% przy otwarciu',
    depthStressFactor: 0.8,
    transform: (s) => {
      let week = 0;
      return s.map((x) => {
        const d = new Date(x.t);
        const mondayOpen = d.getUTCDay() === 1 && d.getUTCHours() === 13;
        if (mondayOpen) week++;
        // every third Monday reopens with a gap, then the series continues from there
        const gap = mondayOpen && week % 3 === 0 ? 0.86 : 1;
        return gap === 1 ? x : { ...x, p: x.p * gap };
      });
    }
  },
  {
    id: 'weekend_tail',
    label: 'Ogon: gap -22% w weekend + cienka ksiega',
    depthStressFactor: 0.35,
    transform: (s) => {
      let week = 0;
      return s.map((x) => {
        const d = new Date(x.t);
        // przecena dzieje sie w sobote, kiedy rynek bazowy jest zamkniety
        const saturday = d.getUTCDay() === 6 && d.getUTCHours() === 10;
        if (saturday) week++;
        return (saturday && week % 4 === 0) ? { ...x, p: x.p * 0.78 } : x;
      });
    }
  },
  {
    id: 'depth_collapse',
    label: 'Zapaść płynności (-70% głębokości)',
    depthStressFactor: 0.3,
    transform: (s) => s
  },
  {
    id: 'earnings_gap',
    label: 'Gap pojedynczej spolki -18% (earnings)',
    depthStressFactor: 0.6,
    transform: (s) => {
      let n = 0;
      return s.map((x) => {
        const d = new Date(x.t);
        // wyniki publikowane po zamknieciu sesji, repricing dopiero nastepnego dnia
        const afterClose = d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && d.getUTCHours() === 21;
        if (afterClose) n++;
        return (afterClose && n % 11 === 0) ? { ...x, p: x.p * 0.82 } : x;
      });
    }
  },
  {
    id: 'vol_spike',
    label: 'Skok zmienności (earnings)',
    depthStressFactor: 0.7,
    transform: (s) => s.map((x, i) => i % 97 === 0 ? { ...x, p: x.p * (1 + (i % 194 === 0 ? -0.06 : 0.05)) } : x)
  }
];
