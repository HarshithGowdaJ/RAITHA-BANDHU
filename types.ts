
export type Language = 'en' | 'kn';

export interface MarketPrice {
  crop: string;
  price: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  mandi: string;
}

export interface WeatherData {
  temp: number;
  condition: string;
  humidity: number;
  forecast: string;
}

export interface MarketplaceItem {
  id: string;
  farmerName: string;
  crop: string;
  quantity: string;
  price: string;
  location: string;
  image: string;
}

export interface EquipmentItem {
  id: string;
  name: string;
  type: string;
  pricePerHour: number;
  owner: string;
  contact: string;
  image: string;
}
