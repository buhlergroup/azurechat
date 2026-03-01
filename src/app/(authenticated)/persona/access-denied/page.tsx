const PersonaAuthError = () => {
    return (
        <div className="flex flex-col items-center justify-center h-screen w-screen">
      <div className="m-auto w-96">
        <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
        <p className="text-base text-muted-foreground">
          You do not have the necessary permissions to access this Agent.
          Please contact the person who shared this agent with you for further
          assistance.
        </p>
      </div>
    </div>
  );
};

export default PersonaAuthError;
