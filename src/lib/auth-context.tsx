import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getCache, setCache, CACHE_TTL, getUserProfileCacheKey } from '@/utils/cache';
import { logger } from '@/utils/logger';

export interface UserProfile {
  role: string | null;
  full_name: string | null;
  terms_agreement?: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  resetPasswordForEmail: (email: string) => Promise<{ error: Error | null }>;
  /** Magic link — the sign-in the design specifies ("Send me a link"). */
  sendMagicLink: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: Error | null }>;
  checkUserHasPassword: (email: string) => Promise<{ hasPassword: boolean; error: Error | null }>;
  checkUserExists: (email: string) => Promise<{ exists: boolean; error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const profileFetchedForRef = useRef<string | null>(null);

  // Fetch user profile once when user changes (single source of truth for role, name, terms)
  useEffect(() => {
    if (loading) return;
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      profileFetchedForRef.current = null;
      return;
    }
    if (profileFetchedForRef.current === user.id) return;
    profileFetchedForRef.current = user.id;

    const cacheKey = getUserProfileCacheKey(user.id);
    const cached = getCache<UserProfile>(cacheKey);
    if (cached) {
      setProfile(cached);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    Promise.resolve(
      supabase
        .from('profiles')
        .select('role, full_name, terms_agreement')
        .eq('id', user.id)
        .maybeSingle()
    )
      .then(({ data }) => {
        if (data) {
          const p: UserProfile = { role: data.role, full_name: data.full_name, terms_agreement: data.terms_agreement };
          setProfile(p);
          setCache(cacheKey, p, CACHE_TTL.USER_PROFILE);
        } else {
          setProfile(null);
        }
      })
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false));
  }, [user, loading]);

  useEffect(() => {
    // Handle OAuth callback - check for hash fragment first
    const handleOAuthCallback = async () => {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      if (hashParams.get('access_token') || hashParams.get('error')) {
        try {
          // Supabase will automatically process the hash and set the session
          const { data: { session }, error } = await supabase.auth.getSession();
          if (error) {
            if (import.meta.env.DEV) {
              console.error('Error getting session from OAuth callback:', error);
            }
            setLoading(false);
            return;
          }
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
        } catch (error) {
          if (import.meta.env.DEV) {
            console.error('Error processing OAuth callback:', error);
          }
          setLoading(false);
        }
      }
    };

    // Process OAuth callback if hash is present
    handleOAuthCallback();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Handle SIGNED_OUT event explicitly
        if (event === 'SIGNED_OUT') {
          setSession(null);
          setUser(null);
          setLoading(false);
          // Clear localStorage completely
          if (typeof window !== 'undefined') {
            const keys = Object.keys(localStorage);
            keys.forEach(key => {
              if (key.startsWith('sb-') || key.includes('supabase')) {
                localStorage.removeItem(key);
              }
            });
          }
          return;
        }
        
        // For other events, update state normally
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        
        // Clean up URL hash after successful auth
        if (event === 'SIGNED_IN' && window.location.hash) {
          setTimeout(() => {
            if (window.location.hash) {
              window.history.replaceState(null, '', window.location.pathname);
            }
          }, 100);
        }
      }
    );

    // Get initial session (fallback if no hash)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth`,
        scopes: 'openid email profile',
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });
    if (error) throw error;
  };

  const signUpWithEmail = async (email: string, password: string, fullName: string) => {
    // First check if user already exists
    const { exists: userExists } = await checkUserExists(email);
    
    if (userExists) {
      // User exists - check if they have a password
      const { hasPassword } = await checkUserHasPassword(email);
      if (hasPassword) {
        // User exists and has password - they already signed up with email/password
        return { error: new Error('An account with this email already exists. Please sign in instead.') };
      } else {
        // User exists but no password - it's a Google Auth user
        return { error: new Error('An account with this email already exists. Please use Google sign-in or use a different email.') };
      }
    }

    // User doesn't exist - proceed with sign-up
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth`,
        data: {
          full_name: fullName,
        },
      },
    });

    if (signUpError) {
      // Check if error is due to existing email (shouldn't happen if checkUserExists worked, but handle it anyway)
      if (signUpError.message.includes('already registered') || 
          signUpError.message.includes('already exists') ||
          signUpError.message.includes('User already registered')) {
        // Email exists - check if it's Google Auth user
        const { hasPassword: hasPwd } = await checkUserHasPassword(email);
        if (!hasPwd) {
          return { error: new Error('An account with this email already exists. Please use Google sign-in or use a different email.') };
        }
        return { error: new Error('An account with this email already exists. Please sign in instead.') };
      }
      // Keep the real reason for debugging; the user only sees a safe message.
      const code = (signUpError as { code?: string }).code;
      console.error('signUp failed', { status: signUpError.status, code, message: signUpError.message });
      if (signUpError.status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
        return { error: new Error('Too many sign-up attempts right now. Please wait a few minutes, or use Continue with Google.') };
      }
      if (code === 'unexpected_failure' || (signUpError.status ?? 0) >= 500) {
        // Seen on 2026-10-20: the confirmation email provider ran out of credits and rejected the send.
        return { error: new Error("We couldn't send your confirmation email right now. Please use Continue with Google, or try again later.") };
      }
      if (code === 'weak_password') {
        return { error: new Error('That password is too easy to guess. Please choose a longer, less common one.') };
      }
      // Return generic error to prevent information disclosure
      return { error: new Error('Failed to create account. Please try again.') };
    }

    // Check if user was actually created
    if (!signUpData.user) {
      // User was not created - this shouldn't happen if checkUserExists worked
      // But handle it gracefully
      return { error: new Error('Failed to create account. Please try again.') };
    }

    // User was created successfully
    // If email confirmation is required, user won't be authenticated yet (no session)
    // This is normal and expected behavior
    const { data: { session } } = await supabase.auth.getSession();
    
    // Only create/update profile if user is authenticated
    // The trigger handle_new_user() should create the profile automatically when user is created
    // But if user is authenticated, we can safely update it
    if (session && session.user && session.user.id === signUpData.user.id) {
      // User is authenticated - we can upsert the profile
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: signUpData.user.id,
          email: signUpData.user.email || email,
          full_name: fullName,
        }, {
          onConflict: 'id'
        });

      if (profileError) {
        if (import.meta.env.DEV) {
          console.error('Error creating profile:', profileError);
        }
        // If profile creation fails, log it but don't fail sign-up
        // The trigger might have already created it, or it will be created after email confirmation
      }
    } else {
      // User is not authenticated yet (email confirmation required)
      // The trigger handle_new_user() will create the profile automatically when user confirms email
      // We don't need to do anything here - attempting to upsert would fail with 401
      if (import.meta.env.DEV) {
        logger.log('User created but not authenticated yet. Profile will be created by trigger after email confirmation.');
      }
    }

    return { error: null };
  };

  const signInWithEmail = async (email: string, password: string) => {
    // Try to sign in first - this is the most reliable way to check
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    
    // If sign-in succeeds, we're done
    if (!signInError) {
      return { error: null };
    }
    
    // Sign-in failed - check the error type
    if (signInError.message.includes('Invalid login credentials') || 
        signInError.message.includes('Email not confirmed') ||
        signInError.message.includes('Invalid login')) {
      // User exists but password is wrong OR user exists but no password (Google Auth)
      // First check if user exists
      const { exists: userExists } = await checkUserExists(email);
      
      if (!userExists) {
        // User doesn't exist - show generic error
        return { error: new Error('Invalid email or password') };
      }
      
      // User exists - check if they have a password
      const { hasPassword } = await checkUserHasPassword(email);
      
      if (!hasPassword) {
        // User exists but has no password - it's a Google Auth user
        return { error: new Error('You previously signed in with Google. Please use the "Continue with Google" button to sign in.') };
      }
      // User exists and has password but it's wrong
      return { error: new Error('Invalid email or password') };
    }
    
    // Other errors (user not found, network error, etc.)
    // Show generic error to prevent email enumeration
    return { error: new Error('Invalid email or password') };
  };

  const checkUserHasPassword = async (email: string) => {
    try {
      const { data, error } = await supabase.rpc('check_user_has_password', {
        user_email: email
      });

      if (error) {
        // If function returns error, assume user doesn't exist (return false)
        // This prevents email enumeration
        return { hasPassword: false, error: null };
      }

      return { hasPassword: data === true, error: null };
    } catch (error) {
      return { hasPassword: false, error: error as Error };
    }
  };

  const checkUserExists = async (email: string) => {
    try {
      const { data, error } = await supabase.rpc('check_user_exists', {
        user_email: email
      });

      if (error) {
        // If function returns error, assume user doesn't exist (return false)
        // This prevents email enumeration
        return { exists: false, error: null };
      }

      return { exists: data === true, error: null };
    } catch (error) {
      return { exists: false, error: error as Error };
    }
  };

  const resetPasswordForEmail = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth?type=reset-password`,
    });
    return { error: error as Error | null };
  };

  /* account-01-sign-in.png draws a passwordless form: Google, then an email
     field, then "Send me a link". Password sign-in stays alongside it rather
     than being replaced — eight existing accounts have passwords, and swapping
     the method outright would lock them out if mail delivery is not configured.

     shouldCreateUser is left at its default so a link works for a new address
     as well as an existing one, matching the single-field flow the mockup
     draws: one field, one button, no separate sign-up. */
  const sendMagicLink = async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth` },
    });
    return { error: error as Error | null };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    try {
      // Clear local state first to prevent any UI flicker
      setUser(null);
      setSession(null);
      
      // Sign out from Supabase - this will trigger SIGNED_OUT event
      // Try global first, fallback to local if it fails
      let error;
      try {
        const result = await supabase.auth.signOut({ scope: 'global' });
        error = result.error;
      } catch (globalError) {
        // If global fails (403), try local
        const result = await supabase.auth.signOut({ scope: 'local' });
        error = result.error;
      }
      
      // Clear localStorage completely regardless of API response
      if (typeof window !== 'undefined') {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith('sb-') || key.includes('supabase') || key.includes('auth')) {
            localStorage.removeItem(key);
          }
        });
        
        // Also clear sessionStorage
        const sessionKeys = Object.keys(sessionStorage);
        sessionKeys.forEach(key => {
          if (key.startsWith('sb-') || key.includes('supabase') || key.includes('auth')) {
            sessionStorage.removeItem(key);
          }
        });
      }
      
      // Force state update to ensure we're logged out
      setUser(null);
      setSession(null);
      
      // If there's an error but we've cleared everything, that's okay
      if (error && import.meta.env.DEV) {
        console.warn('Error during sign out (but state cleared):', error);
      }
    } catch (error) {
      // Even if signOut fails completely, clear everything
      setUser(null);
      setSession(null);
      
      // Clear all storage as fallback
      if (typeof window !== 'undefined') {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
          if (key.startsWith('sb-') || key.includes('supabase') || key.includes('auth')) {
            localStorage.removeItem(key);
          }
        });
        
        const sessionKeys = Object.keys(sessionStorage);
        sessionKeys.forEach(key => {
          if (key.startsWith('sb-') || key.includes('supabase') || key.includes('auth')) {
            sessionStorage.removeItem(key);
          }
        });
      }
      
      if (import.meta.env.DEV) {
        console.error('Error during sign out:', error);
      }
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      session, 
      loading,
      profile,
      profileLoading,
      signInWithGoogle, 
      signUpWithEmail, 
      signInWithEmail,
      sendMagicLink,
      resetPasswordForEmail,
      updatePassword,
      checkUserHasPassword,
      checkUserExists,
      signOut 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

/** True while the saved session is still being restored on a cold load. Safe
 *  outside a provider (false), so shared guards and their tests need no wrapper. */
export function useAuthLoading(): boolean {
  return useContext(AuthContext)?.loading ?? false;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
