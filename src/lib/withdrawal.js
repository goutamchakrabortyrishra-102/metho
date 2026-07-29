const DEFAULT_TDS_PERCENT = 5;
const DEFAULT_ADMIN_CHARGE_PERCENT = 3;

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const pickNumber = (...values) => {
  for (const value of values) {
    const num = toFiniteNumber(value);
    if (num !== null) return num;
  }
  return null;
};

export const resolveWithdrawalDeductionRates = (settings = {}) => {
  const tdsPercent = pickNumber(
    settings?.withdrawal_tds_percent,
    settings?.wallet_withdraw_tds_percent,
    settings?.tds_percent,
    settings?.payout_tds_percent,
    settings?.withdrawal_tax_percent
  );
  const adminChargePercent = pickNumber(
    settings?.withdrawal_admin_charge_percent,
    settings?.wallet_withdraw_admin_charge_percent,
    settings?.admin_charge_percent,
    settings?.payout_admin_charge_percent,
    settings?.withdrawal_processing_fee_percent
  );

  return {
    tdsPercent: tdsPercent === null ? DEFAULT_TDS_PERCENT : tdsPercent,
    adminChargePercent: adminChargePercent === null ? DEFAULT_ADMIN_CHARGE_PERCENT : adminChargePercent,
  };
};

export const getWithdrawalBreakdown = (withdrawal = {}, rates = resolveWithdrawalDeductionRates()) => {
  const grossAmount = pickNumber(
    withdrawal?.gross_amount,
    withdrawal?.requested_amount,
    withdrawal?.request_amount,
    withdrawal?.withdrawal_amount,
    withdrawal?.amount,
    0
  );

  let tdsAmount = pickNumber(withdrawal?.tds_amount, withdrawal?.tds, withdrawal?.tax_amount);
  let adminChargeAmount = pickNumber(
    withdrawal?.admin_charge_amount,
    withdrawal?.admin_charge,
    withdrawal?.service_charge_amount,
    withdrawal?.processing_fee_amount
  );

  if (tdsAmount === null) tdsAmount = (grossAmount * (Number(rates?.tdsPercent) || 0)) / 100;
  if (adminChargeAmount === null) adminChargeAmount = (grossAmount * (Number(rates?.adminChargePercent) || 0)) / 100;

  let netAmount = pickNumber(
    withdrawal?.net_amount,
    withdrawal?.payout_amount,
    withdrawal?.final_amount,
    withdrawal?.payable_amount
  );
  if (netAmount === null) {
    netAmount = grossAmount - tdsAmount - adminChargeAmount;
  }

  return {
    grossAmount: round2(grossAmount),
    tdsAmount: round2(tdsAmount),
    adminChargeAmount: round2(adminChargeAmount),
    netAmount: round2(netAmount),
    tdsPercent: Number(rates?.tdsPercent) || 0,
    adminChargePercent: Number(rates?.adminChargePercent) || 0,
  };
};
