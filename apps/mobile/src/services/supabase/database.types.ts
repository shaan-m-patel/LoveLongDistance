export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      couple_members: {
        Row: { couple_id: string; joined_at: string; user_id: string };
        Insert: { couple_id: string; joined_at?: string; user_id: string };
        Update: { couple_id?: string; joined_at?: string; user_id?: string };
        Relationships: [
          {
            foreignKeyName: 'couple_members_couple_id_fkey';
            columns: ['couple_id'];
            isOneToOne: false;
            referencedRelation: 'couples';
            referencedColumns: ['id'];
          },
        ];
      };
      couple_prompts: {
        Row: {
          category: Json | null;
          couple_id: string;
          created_at: string;
          id: string;
          is_revealed: boolean;
          prompt_date: string;
          question: string;
        };
        Insert: {
          category?: Json | null;
          couple_id: string;
          created_at?: string;
          id?: string;
          is_revealed?: boolean;
          prompt_date: string;
          question: string;
        };
        Update: {
          category?: Json | null;
          couple_id?: string;
          created_at?: string;
          id?: string;
          is_revealed?: boolean;
          prompt_date?: string;
          question?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'couple_prompts_couple_id_fkey';
            columns: ['couple_id'];
            isOneToOne: false;
            referencedRelation: 'couples';
            referencedColumns: ['id'];
          },
        ];
      };
      couples: {
        Row: {
          created_at: string;
          id: string;
          is_complete: boolean;
          reunion_date: string | null;
          reunion_end_date: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_complete?: boolean;
          reunion_date?: string | null;
          reunion_end_date?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_complete?: boolean;
          reunion_date?: string | null;
          reunion_end_date?: string | null;
        };
        Relationships: [];
      };
      habit_completions: {
        Row: { created_at: string; habit_id: string; user_id: string; ymd: string };
        Insert: { created_at?: string; habit_id: string; user_id: string; ymd: string };
        Update: { created_at?: string; habit_id?: string; user_id?: string; ymd?: string };
        Relationships: [
          {
            foreignKeyName: 'habit_completions_habit_id_fkey';
            columns: ['habit_id'];
            isOneToOne: false;
            referencedRelation: 'habits';
            referencedColumns: ['id'];
          },
        ];
      };
      habits: {
        Row: {
          completion_policy: string;
          couple_id: string;
          created_at: string;
          goal: Json | null;
          id: string;
          title: string;
          type: string;
        };
        Insert: {
          completion_policy: string;
          couple_id: string;
          created_at?: string;
          goal?: Json | null;
          id?: string;
          title: string;
          type: string;
        };
        Update: {
          completion_policy?: string;
          couple_id?: string;
          created_at?: string;
          goal?: Json | null;
          id?: string;
          title?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'habits_couple_id_fkey';
            columns: ['couple_id'];
            isOneToOne: false;
            referencedRelation: 'couples';
            referencedColumns: ['id'];
          },
        ];
      };
      invites: {
        Row: {
          consumed_at: string | null;
          consumed_by_user_id: string | null;
          couple_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          inviter_id: string;
          token: string;
        };
        Insert: {
          consumed_at?: string | null;
          consumed_by_user_id?: string | null;
          couple_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          inviter_id: string;
          token: string;
        };
        Update: {
          consumed_at?: string | null;
          consumed_by_user_id?: string | null;
          couple_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          inviter_id?: string;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'invites_couple_id_fkey';
            columns: ['couple_id'];
            isOneToOne: false;
            referencedRelation: 'couples';
            referencedColumns: ['id'];
          },
        ];
      };
      memories: {
        Row: {
          couple_id: string;
          created_at: string;
          deep_link_ref: string;
          id: string;
          image_storage_path: string | null;
          is_favorite: boolean;
          milestone_kind: string | null;
          summary: string;
          title: string;
          type: string;
        };
        Insert: {
          couple_id: string;
          created_at?: string;
          deep_link_ref?: string;
          id?: string;
          image_storage_path?: string | null;
          is_favorite?: boolean;
          milestone_kind?: string | null;
          summary?: string;
          title: string;
          type: string;
        };
        Update: {
          couple_id?: string;
          created_at?: string;
          deep_link_ref?: string;
          id?: string;
          image_storage_path?: string | null;
          is_favorite?: boolean;
          milestone_kind?: string | null;
          summary?: string;
          title?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'memories_couple_id_fkey';
            columns: ['couple_id'];
            isOneToOne: false;
            referencedRelation: 'couples';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_digest_keys: {
        Row: {
          created_at: string;
          dedupe_key: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          dedupe_key: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          dedupe_key?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          category: string;
          created_at: string;
          href: string | null;
          id: string;
          push_dispatched_at: string | null;
          read: boolean;
          summary: string;
          title: string;
          user_id: string;
        };
        Insert: {
          category: string;
          created_at?: string;
          href?: string | null;
          id?: string;
          push_dispatched_at?: string | null;
          read?: boolean;
          summary?: string;
          title: string;
          user_id: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          href?: string | null;
          id?: string;
          push_dispatched_at?: string | null;
          read?: boolean;
          summary?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      presence_posts: {
        Row: {
          author_id: string;
          caption: string | null;
          couple_id: string;
          created_at: string;
          id: string;
          location_label: string | null;
          mood: string | null;
          reaction_count: number;
          storage_path: string;
        };
        Insert: {
          author_id: string;
          caption?: string | null;
          couple_id: string;
          created_at?: string;
          id?: string;
          location_label?: string | null;
          mood?: string | null;
          reaction_count?: number;
          storage_path: string;
        };
        Update: {
          author_id?: string;
          caption?: string | null;
          couple_id?: string;
          created_at?: string;
          id?: string;
          location_label?: string | null;
          mood?: string | null;
          reaction_count?: number;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'presence_posts_couple_id_fkey';
            columns: ['couple_id'];
            isOneToOne: false;
            referencedRelation: 'couples';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_storage_path: string | null;
          created_at: string;
          display_name: string | null;
          first_name: string;
          id: string;
          subscription_tier: string;
          time_zone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_storage_path?: string | null;
          created_at?: string;
          display_name?: string | null;
          first_name?: string;
          id: string;
          subscription_tier?: string;
          time_zone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_storage_path?: string | null;
          created_at?: string;
          display_name?: string | null;
          first_name?: string;
          id?: string;
          subscription_tier?: string;
          time_zone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      prompt_answers: {
        Row: {
          body: string;
          couple_prompt_id: string;
          id: string;
          image_storage_path: string | null;
          submitted_at: string;
          user_id: string;
        };
        Insert: {
          body?: string;
          couple_prompt_id: string;
          id?: string;
          image_storage_path?: string | null;
          submitted_at?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          couple_prompt_id?: string;
          id?: string;
          image_storage_path?: string | null;
          submitted_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_answers_couple_prompt_id_fkey';
            columns: ['couple_prompt_id'];
            isOneToOne: false;
            referencedRelation: 'couple_prompts';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_reactions: {
        Row: {
          couple_prompt_id: string;
          created_at: string;
          emoji: string;
          id: string;
          user_id: string;
        };
        Insert: {
          couple_prompt_id: string;
          created_at?: string;
          emoji: string;
          id?: string;
          user_id: string;
        };
        Update: {
          couple_prompt_id?: string;
          created_at?: string;
          emoji?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_reactions_couple_prompt_id_fkey';
            columns: ['couple_prompt_id'];
            isOneToOne: false;
            referencedRelation: 'couple_prompts';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_replies: {
        Row: {
          author_id: string;
          body: string;
          couple_prompt_id: string;
          created_at: string;
          id: string;
          parent_reply_id: string | null;
        };
        Insert: {
          author_id: string;
          body: string;
          couple_prompt_id: string;
          created_at?: string;
          id?: string;
          parent_reply_id?: string | null;
        };
        Update: {
          author_id?: string;
          body?: string;
          couple_prompt_id?: string;
          created_at?: string;
          id?: string;
          parent_reply_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_replies_couple_prompt_id_fkey';
            columns: ['couple_prompt_id'];
            isOneToOne: false;
            referencedRelation: 'couple_prompts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'prompt_replies_parent_reply_id_fkey';
            columns: ['parent_reply_id'];
            isOneToOne: false;
            referencedRelation: 'prompt_replies';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_reply_reactions: {
        Row: {
          created_at: string;
          emoji: string;
          id: string;
          reply_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          emoji: string;
          id?: string;
          reply_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          emoji?: string;
          id?: string;
          reply_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_reply_reactions_reply_id_fkey';
            columns: ['reply_id'];
            isOneToOne: false;
            referencedRelation: 'prompt_replies';
            referencedColumns: ['id'];
          },
        ];
      };
      prompt_voice_placeholders: {
        Row: {
          couple_prompt_id: string;
          created_at: string;
          id: string;
          label: string;
        };
        Insert: {
          couple_prompt_id: string;
          created_at?: string;
          id?: string;
          label: string;
        };
        Update: {
          couple_prompt_id?: string;
          created_at?: string;
          id?: string;
          label?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'prompt_voice_placeholders_couple_prompt_id_fkey';
            columns: ['couple_prompt_id'];
            isOneToOne: false;
            referencedRelation: 'couple_prompts';
            referencedColumns: ['id'];
          },
        ];
      };
      ritual_signals: {
        Row: {
          author_id: string;
          body: string;
          couple_id: string;
          created_at: string;
          id: string;
          kind: string;
        };
        Insert: {
          author_id: string;
          body: string;
          couple_id: string;
          created_at?: string;
          id?: string;
          kind: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          couple_id?: string;
          created_at?: string;
          id?: string;
          kind?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'ritual_signals_couple_id_fkey';
            columns: ['couple_id'];
            isOneToOne: false;
            referencedRelation: 'couples';
            referencedColumns: ['id'];
          },
        ];
      };
      user_app_settings: {
        Row: {
          allow_nsfw_prompts: boolean;
          is_passcode_set: boolean;
          product_analytics: boolean;
          redact_previews: boolean;
          require_passcode: boolean;
          share_presence: boolean;
          updated_at: string;
          use_biometric: boolean;
          user_id: string;
        };
        Insert: {
          allow_nsfw_prompts?: boolean;
          is_passcode_set?: boolean;
          product_analytics?: boolean;
          redact_previews?: boolean;
          require_passcode?: boolean;
          share_presence?: boolean;
          updated_at?: string;
          use_biometric?: boolean;
          user_id: string;
        };
        Update: {
          allow_nsfw_prompts?: boolean;
          is_passcode_set?: boolean;
          product_analytics?: boolean;
          redact_previews?: boolean;
          require_passcode?: boolean;
          share_presence?: boolean;
          updated_at?: string;
          use_biometric?: boolean;
          user_id?: string;
        };
        Relationships: [];
      };
      user_push_tokens: {
        Row: {
          expo_push_token: string;
          id: string;
          platform: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          expo_push_token: string;
          id?: string;
          platform?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          expo_push_token?: string;
          id?: string;
          platform?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_notification_prefs: {
        Row: {
          anniversaries: boolean;
          countdown_updates: boolean;
          habit_reminder: boolean;
          milestones: boolean;
          new_photo: boolean;
          reactions: boolean;
          unanswered_prompt: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          anniversaries?: boolean;
          countdown_updates?: boolean;
          habit_reminder?: boolean;
          milestones?: boolean;
          new_photo?: boolean;
          reactions?: boolean;
          unanswered_prompt?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          anniversaries?: boolean;
          countdown_updates?: boolean;
          habit_reminder?: boolean;
          milestones?: boolean;
          new_photo?: boolean;
          reactions?: boolean;
          unanswered_prompt?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      waitlist_signups: {
        Row: {
          created_at: string;
          email: string;
          id: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          id?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_invite: { Args: { expires_in?: string }; Returns: Json };
      redeem_plus_promo: { Args: { p_code: string }; Returns: Json };
      increment_presence_reaction: { Args: { p_post_id: string }; Returns: undefined };
      hidden_prompt_partner: { Args: { p_prompt_id: string }; Returns: string };
      run_notification_digest_job: { Args: Record<PropertyKey, never>; Returns: undefined };
      is_member_of_couple: {
        Args: { p_couple_id: string; p_user_id: string };
        Returns: boolean;
      };
      user_couple_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
