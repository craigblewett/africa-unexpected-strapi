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

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'general.contact': GeneralContact;
      'general.highlight': GeneralHighlight;
      'general.photo': GeneralPhoto;
      'general.rate': GeneralRate;
      'general.review': GeneralReview;
      'general.tag': GeneralTag;
      'general.unexpected': GeneralUnexpected;
    }
  }
}
