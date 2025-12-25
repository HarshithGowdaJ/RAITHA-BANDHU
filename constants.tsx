
import React from 'react';
import { MarketPrice, MarketplaceItem, EquipmentItem } from './types';

export const MOCK_PRICES: MarketPrice[] = [
  { crop: "Sugarcane (ಕಬ್ಬು)", price: 3150, unit: "Ton", trend: "up", mandi: "Maddur" },
  { crop: "Paddy (ಭತ್ತ)", price: 2350, unit: "Quintal", trend: "stable", mandi: "Mandya" },
  { crop: "Ragi (ರಾಗಿ)", price: 4200, unit: "Quintal", trend: "up", mandi: "Malavalli" },
  { crop: "Maize (ಮೆಕ್ಕೆಜೋಳ)", price: 2100, unit: "Quintal", trend: "down", mandi: "Pandavapura" },
];

export const MOCK_MARKETPLACE: MarketplaceItem[] = [
  { id: "1", farmerName: "Kempanna", crop: "Organic Jaggery", quantity: "100 KG", price: "₹65/KG", location: "Koppa", image: "https://picsum.photos/seed/jaggery/400/300" },
  { id: "2", farmerName: "Basavaraju", crop: "Basmati Paddy", quantity: "50 Quintals", price: "₹2400/Q", location: "Hulivana", image: "https://picsum.photos/seed/paddy/400/300" },
];

export const MOCK_EQUIPMENT: EquipmentItem[] = [
  { id: "e1", name: "Mahindra Tractor", type: "Tractor", pricePerHour: 800, owner: "Somanna", contact: "9876543210", image: "https://picsum.photos/seed/tractor/400/300" },
  { id: "e2", name: "Paddy Harvester", type: "Harvester", pricePerHour: 1500, owner: "Gowda", contact: "9123456789", image: "https://picsum.photos/seed/harvester/400/300" },
];

export const COLORS = {
  primary: "#2d6a4f", // Dark Green
  secondary: "#bc6c25", // Terracotta
  background: "#fdfaf5", // Off-white/Cream
  accent: "#d4a373", // Wheat
  dark: "#1b4332",
  text: "#3e2723" // Deep Coffee
};
