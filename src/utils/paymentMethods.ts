import { PaymentMethod } from '@/types/pos';
export const PAYMENT_METHODS: {value: PaymentMethod; label: string}[] = [
 {value:'cash',label:'Cash'}, {value:'card',label:'Card'}, {value:'bank_transfer',label:'Bank Transfer'},
 {value:'sadapay',label:'SadaPay'}, {value:'easypaisa',label:'Easypaisa'},
 {value:'nayapay',label:'NayaPay'}, {value:'jazzcash',label:'JazzCash'}, {value:'raast',label:'Raast'},
 {value:'credit',label:'Credit/Khata/Udhar'},
 {value:'wallet',label:'Digital Wallet (Legacy)'},
];
export const paymentLabel = (method: PaymentMethod) => PAYMENT_METHODS.find(x=>x.value===method)?.label ?? method;
