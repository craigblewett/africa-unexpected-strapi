import type { Schema, Struct } from '@strapi/strapi';

export interface GeneralContact extends Struct.ComponentSchema {
  collectionName: 'components_general_contacts';
  info: {
    displayName: 'Contact';
  };
  attributes: {
    booking_url: Schema.Attribute.String;
    email: Schema.Attribute.Email;
    google_info: Schema.Attribute.String;
    phone: Schema.Attribute.String;
    website: Schema.Attribute.String;
    whatsapp: Schema.Attribute.String;
  };
}

export interface GeneralHighlight extends Struct.ComponentSchema {
  collectionName: 'components_general_highlights';
  info: {
    displayName: 'Highlight';
  };
  attributes: {
    description: Schema.Attribute.String;
    title: Schema.Attribute.String;
  };
}

export interface GeneralPhoto extends Struct.ComponentSchema {
  collectionName: 'components_general_photos';
  info: {
    displayName: 'Photo';
  };
  attributes: {
    attribution: Schema.Attribute.Text;
    image: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
  };
}

export interface GeneralRate extends Struct.ComponentSchema {
  collectionName: 'components_general_rates';
  info: {
    displayName: 'Rate';
  };
  attributes: {
    amount: Schema.Attribute.Decimal;
    unit: Schema.Attribute.String;
  };
}

export interface GeneralReview extends Struct.ComponentSchema {
  collectionName: 'components_general_reviews';
  info: {
    displayName: 'Review';
  };
  attributes: {
    author_name: Schema.Attribute.String;
    author_photo: Schema.Attribute.Media<
      'images' | 'files' | 'videos' | 'audios'
    >;
    rating: Schema.Attribute.Decimal;
    review_time: Schema.Attribute.String;
    text: Schema.Attribute.Text;
  };
}

export interface GeneralSeasonalGuide extends Struct.ComponentSchema {
  collectionName: 'components_general_seasonal_guides';
  info: {
    displayName: 'SeasonalGuide';
  };
  attributes: {
    avoid_season: Schema.Attribute.Enumeration<
      ['Summer', 'Autumn', 'Winter', 'Spring', 'None']
    >;
    best_season: Schema.Attribute.Enumeration<
      ['Summer', 'Autumn', 'Winter', 'Spring', 'Year-round']
    >;
    long_stay_friendly: Schema.Attribute.Boolean;
    seasonal_notes: Schema.Attribute.RichText;
  };
}

export interface GeneralTag extends Struct.ComponentSchema {
  collectionName: 'components_general_tags';
  info: {
    displayName: 'Tag';
  };
  attributes: {
    label: Schema.Attribute.String;
  };
}

export interface GeneralUnexpected extends Struct.ComponentSchema {
  collectionName: 'components_general_unexpecteds';
  info: {
    displayName: 'Unexpected';
  };
  attributes: {
    description: Schema.Attribute.Text;
    title: Schema.Attribute.String;
  };
}

export interface GeneralVibeProfile extends Struct.ComponentSchema {
  collectionName: 'components_general_vibe_profiles';
  info: {
    displayName: 'VibeProfile';
  };
  attributes: {
    accessible_remote: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<50>;
    active_relaxed: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<50>;
    comfort_rustic: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<50>;
    family_couple: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<50>;
    peaceful_social: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<50>;
    wild_managed: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<50>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'general.contact': GeneralContact;
      'general.highlight': GeneralHighlight;
      'general.photo': GeneralPhoto;
      'general.rate': GeneralRate;
      'general.review': GeneralReview;
      'general.seasonal-guide': GeneralSeasonalGuide;
      'general.tag': GeneralTag;
      'general.unexpected': GeneralUnexpected;
      'general.vibe-profile': GeneralVibeProfile;
    }
  }
}
