/* @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PropertiesPage from './PropertiesPage';

const {
  getMock,
  postMock,
  putMock,
  deleteMock,
  navigateMock,
} = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  putMock: vi.fn(),
  deleteMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-1',
      role: 'company_admin',
      company_id: 'company-1',
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('../../services/api', () => ({
  default: {
    get: getMock,
    post: postMock,
    put: putMock,
    delete: deleteMock,
  },
}));

afterEach(() => {
  cleanup();
});

describe('PropertiesPage rich media form flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: { data: [] } });
    postMock.mockResolvedValue({ data: { data: { id: 'property-1' } } });
  });

  it('supports add/remove floor plan rows, serializes payload, and re-renders persisted rich media/location fields', async () => {
    const user = userEvent.setup();

    getMock.mockReset();
    getMock
      .mockResolvedValueOnce({ data: { data: [] } })
      .mockResolvedValueOnce({
        data: {
          data: [
            {
              id: 'property-1',
              name: 'Aurora Homes',
              builder: null,
              location_city: null,
              location_area: null,
              location_pincode: null,
              price_min: null,
              price_max: null,
              bedrooms: null,
              property_type: null,
              status: 'available',
              images: [],
              amenities: [],
              description: null,
              rera_number: null,
              brochure_url: 'https://cdn.example.com/brochure.pdf',
              price_list_url: 'https://cdn.example.com/prices.pdf',
              floor_plan_urls: ['https://cdn.example.com/floor-1.pdf'],
              latitude: 0,
              longitude: 0,
            },
          ],
        },
      });

    render(<PropertiesPage />);

    await screen.findByText('common.no_data');

    await user.click(screen.getByRole('button', { name: 'properties.new_property' }));

    await user.type(screen.getByLabelText('Name *'), 'Aurora Homes');
    await user.type(screen.getByLabelText('Brochure URL'), 'https://cdn.example.com/brochure.pdf');
    await user.type(screen.getByLabelText('Price List URL'), 'https://cdn.example.com/prices.pdf');
    await user.clear(screen.getByLabelText('Latitude'));
    await user.type(screen.getByLabelText('Latitude'), '0');
    await user.clear(screen.getByLabelText('Longitude'));
    await user.type(screen.getByLabelText('Longitude'), '0');

    await user.type(screen.getByLabelText('Floor plan URL 1'), 'https://cdn.example.com/floor-1.pdf');
    await user.click(screen.getByRole('button', { name: 'Add floor plan' }));
    await user.type(screen.getByLabelText('Floor plan URL 2'), 'https://cdn.example.com/floor-2.pdf');
    await user.click(screen.getByRole('button', { name: 'Remove floor plan 2' }));

    await user.click(screen.getByRole('button', { name: 'common.create' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    expect(postMock).toHaveBeenCalledWith(
      '/properties',
      expect.objectContaining({
        name: 'Aurora Homes',
        brochure_url: 'https://cdn.example.com/brochure.pdf',
        price_list_url: 'https://cdn.example.com/prices.pdf',
        floor_plan_urls: ['https://cdn.example.com/floor-1.pdf'],
        latitude: 0,
        longitude: 0,
      }),
    );

    expect(await screen.findByText('Aurora Homes')).toBeInTheDocument();
    expect(screen.getByText('Brochure | Price list | 1 floor plan')).toBeInTheDocument();
    expect(screen.getByText('Coords: 0, 0')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit property' }));

    expect(screen.getByLabelText('Brochure URL')).toHaveValue('https://cdn.example.com/brochure.pdf');
    expect(screen.getByLabelText('Price List URL')).toHaveValue('https://cdn.example.com/prices.pdf');
    expect(screen.getByLabelText('Floor plan URL 1')).toHaveValue('https://cdn.example.com/floor-1.pdf');
    expect(screen.getByLabelText('Latitude')).toHaveValue(0);
    expect(screen.getByLabelText('Longitude')).toHaveValue(0);
  });

  it('renders API save failures in the modal', async () => {
    const user = userEvent.setup();
    postMock.mockRejectedValueOnce({
      response: {
        data: {
          error: 'Failed to save property from API',
        },
      },
    });

    render(<PropertiesPage />);

    await screen.findByText('common.no_data');
    await user.click(screen.getByRole('button', { name: 'properties.new_property' }));

    await user.type(screen.getByLabelText('Name *'), 'Failure Case Homes');
    await user.click(screen.getByRole('button', { name: 'common.create' }));

    expect(await screen.findByText('Failed to save property from API')).toBeInTheDocument();
  });
});
