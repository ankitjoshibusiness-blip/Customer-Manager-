import React, { useMemo, useState } from 'react';
import { ArrowLeft, Calculator, History, PiggyBank, TrendingUp, Wallet } from 'lucide-react';

interface EmiCalculatorProps {
  onBack: () => void;
}

interface EmiHistoryItem {
  id: number;
  principal: number;
  rate: number;
  years: number;
  emi: number;
  interest: number;
  total: number;
  createdAt: number;
}

export const EmiCalculator: React.FC<EmiCalculatorProps> = ({ onBack }) => {
  const [loanText, setLoanText] = useState('1200000');
  const [rateText, setRateText] = useState('8.5');
  const [yearsText, setYearsText] = useState('5');
  const [selectedTab, setSelectedTab] = useState<0 | 1 | 2>(0);
  const [gujarati, setGujarati] = useState(false);
  const [savedHistory, setSavedHistory] = useState<EmiHistoryItem[]>([]);

  const t = (en: string, gu: string) => (gujarati ? gu : en);

  const principal = Math.max(0, parseFloat(loanText) || 0);
  const rate = Math.max(0, parseFloat(rateText) || 0);
  const years = Math.min(40, Math.max(1, parseInt(yearsText, 10) || 1));
  const months = years * 12;
  const monthlyRate = rate / 1200;

  const emi = useMemo(() => {
    if (monthlyRate === 0) return principal / months;
    const factor = Math.pow(1 + monthlyRate, months);
    return (principal * monthlyRate * factor) / (factor - 1);
  }, [principal, monthlyRate, months]);

  const total = emi * months;
  const interest = Math.max(0, total - principal);
  const principalRatio = total > 0 ? Math.max(0.01, Math.min(1, principal / total)) : 1;

  const formatMoney = (value: number) =>
    new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(Math.round(value));

  const saveSnapshot = () => {
    setSavedHistory((prev) => [
      {
        id: Date.now(),
        principal,
        rate,
        years,
        emi,
        interest,
        total,
        createdAt: Date.now(),
      },
      ...prev.slice(0, 9),
    ]);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-xl bg-white border border-[#E3D9F4] text-[#7042C1] hover:bg-[#F0EAFB]"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-11 h-11 rounded-2xl bg-[#8B5CF6] flex items-center justify-center text-white">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-[#211936]">EmiCal</h2>
            <p className="text-[11px] tracking-widest font-semibold text-[#77718A]">
              {t('SMART MONEY. CLEAR PLANS.', 'સ્માર્ટ નાણાં. સ્પષ્ટ આયોજન.')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Sub-navigation tabs */}
          <div className="flex items-center gap-1 p-1 bg-[#EDE5FA] rounded-xl">
            <button
              type="button"
              onClick={() => setSelectedTab(0)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                selectedTab === 0 ? 'bg-white text-[#7042C1] shadow-sm' : 'text-[#625A78]'
              }`}
            >
              <Calculator className="w-3.5 h-3.5" />
              {t('Calculator', 'કેલ્ક્યુલેટર')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedTab(1)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                selectedTab === 1 ? 'bg-white text-[#7042C1] shadow-sm' : 'text-[#625A78]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              {t('History', 'હિસ્ટરી')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedTab(2)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                selectedTab === 2 ? 'bg-white text-[#7042C1] shadow-sm' : 'text-[#625A78]'
              }`}
            >
              <PiggyBank className="w-3.5 h-3.5" />
              {t('Plan', 'પ્લાન')}
            </button>
          </div>

          {/* Language Switch EN / ગુજ */}
          <div className="flex items-center p-1 bg-white border border-[#E3D9F4] rounded-xl">
            <button
              type="button"
              onClick={() => setGujarati(false)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                !gujarati ? 'bg-[#8B5CF6] text-white' : 'text-[#77718A]'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              onClick={() => setGujarati(true)}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                gujarati ? 'bg-[#8B5CF6] text-white' : 'text-[#77718A]'
              }`}
            >
              ગુજ
            </button>
          </div>
        </div>
      </div>

      {selectedTab === 0 && (
        <div className="space-y-6">
          <div>
            <h3 className="text-2xl font-bold text-[#211936]">
              {t('Your loan, simplified.', 'તમારી લોન હવે સરળ.')}
            </h3>
            <p className="text-sm text-[#656B76] mt-1">
              {t('Plan your next big move with confidence.', 'આત્મવિશ્વાસ સાથે નાણાકીય આયોજન કરો.')}
            </p>
          </div>

          <div className="grid lg:grid-cols-12 gap-6 items-start">
            {/* Left column: Summary Card + Breakdown */}
            <div className="lg:col-span-6 space-y-5">
              <div className="rounded-[24px] bg-[#8B5CF6] text-white p-6 space-y-4">
                <div className="flex items-center gap-2 text-white/90 text-xs font-bold tracking-wider">
                  <Wallet className="w-4 h-4" />
                  <span>{t('YOUR MONTHLY EMI', 'તમારી માસિક EMI')}</span>
                </div>
                <p className="text-4xl font-extrabold font-mono-nums">{formatMoney(emi)}</p>
                <div className="border-t border-white/20 pt-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-white/80">{t('Total interest', 'કુલ વ્યાજ')}</p>
                    <p className="text-base font-bold font-mono-nums">{formatMoney(interest)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-white/80">{t('Total payment', 'કુલ ચુકવણી')}</p>
                    <p className="text-base font-bold font-mono-nums">{formatMoney(total)}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-[22px] border border-[#E3D9F4] p-5 space-y-4">
                <div className="flex items-center gap-2 text-[#211936] font-bold text-lg">
                  <TrendingUp className="w-5 h-5 text-[#8B5CF6]" />
                  <span>{t('Payment breakdown', 'ચુકવણીની વિગત')}</span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-[#656B76]">
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#8B5CF6]" />
                    {t('Principal', 'મૂડી રકમ')}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#7083A3]" />
                    {t('Interest', 'વ્યાજ')}
                  </span>
                </div>
                <div className="w-full h-3 rounded-full bg-[#7083A3] overflow-hidden">
                  <div
                    className="h-full bg-[#8B5CF6] rounded-full transition-all duration-200"
                    style={{ width: `${Math.round(principalRatio * 100)}%` }}
                  />
                </div>
                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[#656B76] font-medium">
                      {t('Loan principal', 'લોનની મૂડી')}
                    </span>
                    <span className="font-bold font-mono-nums text-[#8B5CF6]">
                      {formatMoney(principal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#656B76] font-medium">
                      {t('Total interest', 'કુલ વ્યાજ')}
                    </span>
                    <span className="font-bold font-mono-nums text-[#7083A3]">
                      {formatMoney(interest)}
                    </span>
                  </div>
                  <div className="border-t border-[#E3D9F4] pt-2.5 flex items-center justify-between">
                    <span className="text-[#211936] font-bold">
                      {t('Total payable', 'કુલ ચૂકવવાપાત્ર')}
                    </span>
                    <span className="font-extrabold font-mono-nums text-[#211936]">
                      {formatMoney(total)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right column: Inputs */}
            <div className="lg:col-span-6 bg-white rounded-[22px] border border-[#E3D9F4] p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-bold text-[#211936]">
                  {t('Loan details', 'લોનની વિગતો')}
                </h4>
                <button
                  type="button"
                  onClick={saveSnapshot}
                  className="text-xs font-bold text-[#7042C1] hover:underline"
                >
                  {t('SAVE TO HISTORY', 'હિસ્ટરીમાં સાચવો')}
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#656B76] mb-1.5">
                  {t('Loan amount', 'લોનની રકમ')}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={loanText}
                    onChange={(e) => setLoanText(e.target.value.replace(/\D/g, '').slice(0, 15))}
                    placeholder={t('e.g. 1200000', 'દા.ત. 1200000')}
                    className="w-full pr-12 pl-4 py-3 rounded-2xl bg-[#F5F6FA] border border-[#E3D9F4] font-bold font-mono-nums text-[#211936] focus:outline-none focus:border-[#8B5CF6]"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-[#8B5CF6]">
                    ₹
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#656B76] mb-1.5">
                  {t('Interest rate (per year)', 'વાર્ષિક વ્યાજ દર')}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={rateText}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (/^\d*\.?\d*$/.test(val) && val.length <= 10) setRateText(val);
                    }}
                    placeholder={t('e.g. 8.5', 'દા.ત. 8.5')}
                    className="w-full pr-12 pl-4 py-3 rounded-2xl bg-[#F5F6FA] border border-[#E3D9F4] font-bold font-mono-nums text-[#211936] focus:outline-none focus:border-[#8B5CF6]"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-[#8B5CF6]">
                    %
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#656B76] mb-1.5">
                  {t('Loan tenure', 'લોનનો સમયગાળો')}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={yearsText}
                    onChange={(e) => setYearsText(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    placeholder={t('e.g. 5', 'દા.ત. 5')}
                    className="w-full pr-16 pl-4 py-3 rounded-2xl bg-[#F5F6FA] border border-[#E3D9F4] font-bold font-mono-nums text-[#211936] focus:outline-none focus:border-[#8B5CF6]"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-[#8B5CF6]">
                    {t('Years', 'વર્ષ')}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-[#656B76] text-center pt-1">
                {t(
                  'Estimates only • Actual lender terms may vary.',
                  'આ અંદાજિત ગણતરી છે • વાસ્તવિક લોનની શરતો અલગ હોઈ શકે છે.'
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedTab !== 0 && (
        <div className="space-y-4">
          <h3 className="text-2xl font-bold text-[#211936]">
            {selectedTab === 1
              ? t('Your history', 'તમારી હિસ્ટરી')
              : t('Financial planner', 'નાણાકીય આયોજન')}
          </h3>
          <p className="text-sm text-[#656B76]">
            {selectedTab === 1
              ? t(
                  'Your current calculation is ready to review.',
                  'તમારી હાલની ગણતરી અહીં જોઈ શકો છો.'
                )
              : t(
                  'A clearer view of your borrowing power starts with a few simple numbers.',
                  'થોડી વિગતો ભરીને તમારી લોન ક્ષમતા સમજો.'
                )}
          </p>

          <div className="bg-white rounded-[22px] border border-[#E3D9F4] p-6 space-y-3 max-w-xl">
            <p className="text-xs font-bold tracking-wider text-[#8B5CF6]">
              {selectedTab === 1
                ? t('LATEST ESTIMATE', 'તાજેતરનો અંદાજ')
                : t('MONTHLY COMMITMENT', 'માસિક જવાબદારી')}
            </p>
            <p className="text-3xl font-extrabold font-mono-nums text-[#211936]">{formatMoney(emi)}</p>
            <p className="text-sm text-[#656B76]">
              {gujarati
                ? `${formatMoney(principal)} લોન • ${years} વર્ષ • ${rate}% વાર્ષિક`
                : `${formatMoney(principal)} loan • ${years} years • ${rate}% p.a.`}
            </p>
            <button
              type="button"
              onClick={() => setSelectedTab(0)}
              className="px-4 py-2 rounded-xl border border-[#8B5CF6] text-[#8B5CF6] text-sm font-semibold hover:bg-[#F0EAFB]"
            >
              {t('Edit calculation', 'ગણતરીમાં ફેરફાર કરો')}
            </button>
          </div>

          {selectedTab === 1 && savedHistory.length > 0 && (
            <div className="bg-white rounded-[22px] border border-[#E3D9F4] p-5 space-y-3 max-w-xl">
              <p className="text-xs font-bold text-[#77718A]">SAVED ESTIMATES</p>
              <div className="divide-y divide-[#E3D9F4]">
                {savedHistory.map((item) => (
                  <div key={item.id} className="py-2.5 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-bold font-mono-nums text-[#211936]">
                        {formatMoney(item.emi)}/mo
                      </p>
                      <p className="text-xs text-[#77718A]">
                        {formatMoney(item.principal)} · {item.years}y · {item.rate}%
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLoanText(String(item.principal));
                        setRateText(String(item.rate));
                        setYearsText(String(item.years));
                        setSelectedTab(0);
                      }}
                      className="text-xs font-semibold text-[#7042C1] hover:underline"
                    >
                      Load
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-[#656B76]">
            {t(
              'Tip: Compare offers using the same loan amount and tenure.',
              'સૂચન: સરખામણી કરતી વખતે લોનની રકમ અને સમયગાળો સમાન રાખો.'
            )}
          </p>
        </div>
      )}
    </div>
  );
};
