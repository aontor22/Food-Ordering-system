import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const names = [
  ['Greek salad', 'Salad', 12], ['Veg salad', 'Salad', 18], ['Clover Salad', 'Salad', 16], ['Chicken Salad', 'Salad', 24],
  ['Lasagna Rolls', 'Rolls', 14], ['Peri Peri Rolls', 'Rolls', 12], ['Chicken Rolls', 'Rolls', 20], ['Veg Rolls', 'Rolls', 15],
  ['Ripple Ice Cream', 'Deserts', 14], ['Fruit Ice Cream', 'Deserts', 22], ['Jar Ice Cream', 'Deserts', 10], ['Vanilla Ice Cream', 'Deserts', 12],
  ['Chicken Sandwich', 'Sandwich', 12], ['Vegan Sandwich', 'Sandwich', 18], ['Grilled Sandwich', 'Sandwich', 16], ['Bread Sandwich', 'Sandwich', 24],
  ['Cup Cake', 'Cake', 14], ['Vegan Cake', 'Cake', 12], ['Butterscotch Cake', 'Cake', 20], ['Sliced Cake', 'Cake', 15],
  ['Garlic Mushroom', 'Pure Veg', 14], ['Fried Cauliflower', 'Pure Veg', 22], ['Mix Veg Pulao', 'Pure Veg', 10], ['Rice Zucchini', 'Pure Veg', 12],
  ['Cheese Pasta', 'Pasta', 12], ['Tomato Pasta', 'Pasta', 18], ['Creamy Pasta', 'Pasta', 16], ['Chicken Pasta', 'Pasta', 24],
  ['Buttered Noodles', 'Noodles', 14], ['Veg Noodles', 'Noodles', 12], ['Somen Noodles', 'Noodles', 20], ['Cooked Noodles', 'Noodles', 15]
];

async function main() {
  for (const [index, [name, category, price]] of names.entries()) {
    await prisma.product.upsert({
      where: { id: String(index + 1) },
      update: {},
      create: {
        id: String(index + 1),
        name,
        category,
        priceCents: price * 100,
        stock: 100,
        description: 'Freshly prepared with quality ingredients',
        imageUrl: `/seed-food/food_${index + 1}.webp`
      }
    });
  }

  await prisma.coupon.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: { code: 'WELCOME10', percentOff: 10, minimumCents: 2000 }
  });

  await prisma.restaurantSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', timezone: 'Asia/Dhaka', acceptingOrders: true, temporaryClosed: false }
  });
  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    await prisma.openingHour.upsert({
      where: { dayOfWeek },
      update: {},
      create: { dayOfWeek, isClosed: false, open24Hours: true, openMinute: 0, closeMinute: 0 }
    });
  }

  await prisma.fulfillmentSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      deliveryEnabled: true,
      pickupEnabled: true,
      asapEnabled: true,
      scheduledEnabled: true,
      deliveryLeadMinutes: 30,
      pickupLeadMinutes: 15,
      slotIntervalMinutes: 30,
      daysAhead: 7,
      defaultSlotCapacity: 10,
      pickupInstructions: 'Please show your order number at the restaurant counter.'
    }
  });

  const defaultDeliveryFeeCents = Math.max(0, Number(process.env.DELIVERY_FEE_CENTS || 200) || 0);
  const existingDeliveryZones = await prisma.deliveryZone.count();
  if (!existingDeliveryZones) {
    await prisma.deliveryZone.create({
      data: {
        id: 'default-delivery-zone',
        name: 'Standard delivery',
        description: 'Default delivery area. Configure your real delivery zones from the admin panel.',
        feeCents: defaultDeliveryFeeCents,
        minimumOrderCents: 0,
        freeDeliveryThresholdCents: null,
        active: true,
        sortOrder: 0,
      },
    });
  }

  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase();
  const configuredPassword = process.env.ADMIN_PASSWORD?.trim();
  const isProduction = process.env.NODE_ENV === 'production';

  // Never silently create/reset a production administrator with the example password.
  if (isProduction && !configuredPassword) {
    throw new Error('ADMIN_PASSWORD must be configured in production before running the database seed.');
  }

  const password = configuredPassword || 'ChangeMe123!';
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: {
      role: 'ADMIN',
      isActive: true,
      // On Render, setting ADMIN_PASSWORD now also repairs an admin account that
      // was created by an earlier deployment with a different password.
      ...(configuredPassword ? { passwordHash } : {})
    },
    create: {
      name: 'Administrator',
      email,
      role: 'ADMIN',
      isActive: true,
      passwordHash
    }
  });

  console.log(`Seeded ${names.length} products. Admin: ${email}`);
}

main()
  .catch((error) => {
    console.error('Database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
